import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import {
  DEFAULT_STORE_ROLE_PERMISSIONS,
  STORE_OWNER_ROLE_KEY,
  STORE_ROLE_SEEDS,
} from '../../team/store-permissions.js';
import { recordStoreAudit } from '../../activity/store-audit.service.js';
import type { CreateStoreInput, UpdateStoreInput } from './stores.schemas.js';

export const TRIAL_PLAN_KEY = 'starter';
export const TRIAL_DAYS = 14;

function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'store';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function buildRolePermissionRows(tx: {
  storePermission: { findMany: (args: unknown) => Promise<{ id: string; key: string }[]> };
}) {
  const rows = await tx.storePermission.findMany({ select: { id: true, key: true } });
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** Create store + system roles + owner membership + trial subscription. */
export async function createStore(ownerId: string, input: CreateStoreInput, meta: RequestMeta) {
  const prisma = getPrisma();
  const slug = input.slug ?? slugify(input.name);

  const slugTaken = await prisma.store.findUnique({ where: { slug } });
  if (slugTaken) throw conflict('Store slug already in use', { code: 'SLUG_IN_USE' });

  const owner = await prisma.sellerUser.findUnique({ where: { id: ownerId } });
  if (!owner) throw forbidden('Invalid seller');

  const store = await prisma.$transaction(async (tx) => {
    const created = await tx.store.create({
      data: {
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        status: 'ACTIVE',
        ownerId,
        country: input.country?.trim() || null,
        currency: input.currency || 'INR',
        timezone: input.timezone || 'Asia/Kolkata',
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        logo: input.logo || null,
      },
    });

    // System roles for this store.
    const roleIdByKey = new Map<string, string>();
    for (const seed of STORE_ROLE_SEEDS) {
      const role = await tx.storeRole.create({
        data: {
          storeId: created.id,
          key: seed.key,
          name: seed.name,
          description: seed.description,
          isSystem: true,
          status: 'ACTIVE',
        },
      });
      roleIdByKey.set(seed.key, role.id);
    }

    // Default grants (owner gets every catalog permission explicitly so
    // the membership cache never depends on role-key special cases alone).
    const permIdByKey = await buildRolePermissionRows(tx as never);
    for (const [roleKey, permKeys] of Object.entries(DEFAULT_STORE_ROLE_PERMISSIONS)) {
      const roleId = roleIdByKey.get(roleKey);
      if (!roleId) continue;
      for (const permKey of permKeys) {
        const permissionId = permIdByKey.get(permKey);
        if (!permissionId) continue;
        await tx.storeRolePermission.create({ data: { roleId, permissionId } });
      }
    }

    const ownerRoleId = roleIdByKey.get(STORE_OWNER_ROLE_KEY);
    if (!ownerRoleId) throw badRequest('Owner role bootstrap failed');
    await tx.storeMembership.create({
      data: {
        storeId: created.id,
        userId: ownerId,
        roleId: ownerRoleId,
        status: 'ACTIVE',
        invitedBy: ownerId,
      },
    });

    // Trial subscription — payment stays separate from creation. If plans
    // are not seeded yet (fresh DB before seed), the store is still usable;
    // the trial attaches once the catalog exists.
    const trialPlan = await tx.subscriptionPlan.findUnique({ where: { key: TRIAL_PLAN_KEY } });
    if (trialPlan) {
      const now = new Date();
      await tx.storeSubscription.create({
        data: {
          storeId: created.id,
          planId: trialPlan.id,
          status: 'TRIALING',
          billingCycle: trialPlan.billingCycle,
          trialStart: now,
          trialEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60_000),
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60_000),
        },
      });
    }

    await recordStoreAudit(tx, {
      storeId: created.id,
      actorId: ownerId,
      actorEmail: owner.email,
      action: 'store.created',
      resourceType: 'store',
      resourceId: created.id,
      metadata: { name: created.name, slug: created.slug },
      meta,
    });
    return created;
  });

  return store;
}

export async function listMyStores(sellerId: string) {
  const prisma = getPrisma();
  const memberships = await prisma.storeMembership.findMany({
    where: { userId: sellerId, status: 'ACTIVE', store: { deletedAt: null } },
    include: {
      store: {
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: { select: { memberships: true } },
        },
      },
      role: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return memberships.map((m) => ({
    storeId: m.store.id,
    name: m.store.name,
    slug: m.store.slug,
    status: m.store.status,
    roleKey: m.role.key,
    roleName: m.role.name,
    memberCount: m.store._count.memberships,
    subscription: m.store.subscriptions[0]
      ? {
          status: m.store.subscriptions[0].status,
          planKey: m.store.subscriptions[0].plan.key,
          planName: m.store.subscriptions[0].plan.name,
          trialEnd: m.store.subscriptions[0].trialEnd,
          currentPeriodEnd: m.store.subscriptions[0].currentPeriodEnd,
        }
      : null,
    joinedAt: m.joinedAt,
  }));
}

/** Validate membership and return the switch target (workspace switcher). */
export async function switchStore(sellerId: string, storeId: string) {
  const prisma = getPrisma();
  const membership = await prisma.storeMembership.findUnique({
    where: { storeId_userId: { storeId, userId: sellerId } },
    include: {
      store: {
        include: {
          subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
        },
      },
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  if (!membership || membership.status !== 'ACTIVE' || membership.store.deletedAt) {
    throw forbidden('No access to this store');
  }
  return {
    storeId: membership.store.id,
    name: membership.store.name,
    slug: membership.store.slug,
    status: membership.store.status,
    roleKey: membership.role.key,
    permissions: membership.role.permissions.map((rp) => rp.permission.key).sort(),
    subscription: membership.store.subscriptions[0]
      ? {
          status: membership.store.subscriptions[0].status,
          planKey: membership.store.subscriptions[0].plan.key,
        }
      : null,
  };
}

export async function getStore(storeId: string) {
  const prisma = getPrisma();
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
      _count: { select: { memberships: true } },
    },
  });
  if (!store || store.deletedAt) throw notFound('Store not found');
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    category: store.category,
    status: store.status,
    country: store.country,
    currency: store.currency,
    timezone: store.timezone,
    contactEmail: store.contactEmail,
    contactPhone: store.contactPhone,
    logo: store.logo,
    memberCount: store._count.memberships,
    onboardingCompletedAt: store.onboardingCompletedAt,
    subscription: store.subscriptions[0]
      ? {
          status: store.subscriptions[0].status,
          planKey: store.subscriptions[0].plan.key,
          planName: store.subscriptions[0].plan.name,
          trialEnd: store.subscriptions[0].trialEnd,
          currentPeriodEnd: store.subscriptions[0].currentPeriodEnd,
        }
      : null,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

export async function updateStore(
  storeId: string,
  actorId: string,
  actorEmail: string | null,
  input: UpdateStoreInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store || store.deletedAt) throw notFound('Store not found');

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.store.update({
      where: { id: storeId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
        ...(input.country !== undefined ? { country: input.country?.trim() || null } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail || null } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone || null } : {}),
        ...(input.logo !== undefined ? { logo: input.logo || null } : {}),
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'store.updated',
      resourceType: 'store',
      resourceId: storeId,
      meta,
    });
    return next;
  });
  return updated;
}

export async function completeOnboarding(
  storeId: string,
  actorId: string,
  actorEmail: string | null,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.store.update({
      where: { id: storeId },
      data: { onboardingCompletedAt: new Date() },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'store.onboarding_completed',
      resourceType: 'store',
      resourceId: storeId,
      meta,
    });
    return next;
  });
  return { storeId: updated.id, onboardingCompletedAt: updated.onboardingCompletedAt };
}

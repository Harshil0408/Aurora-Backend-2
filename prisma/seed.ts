/**
 * Prisma seed: RBAC catalog + optional Super Admin bootstrap.
 *
 *   npx prisma db seed            # roles + permissions only
 *   SUPER_ADMIN_EMAIL=a@x.com SUPER_ADMIN_PASSWORD=<12+ chars> npx prisma db seed
 *
 * Idempotent (all upserts). The bootstrap admin is created ACTIVE with
 * 2FA NOT yet enrolled — 2FA enrollment becomes mandatory at first login
 * (implemented in the login stage).
 */
import 'dotenv/config';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { getPrisma } from '../src/config/db.js';
import { hashSecret } from '../src/modules/admin-panel/auth/crypto/password.js';
import { normalizeEmail } from '../src/modules/admin-panel/auth/utils/email.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_SEEDS,
  ROLE_SEEDS,
  SUPER_ADMIN_ROLE_KEY,
} from '../src/modules/rbac/permissions.js';
import { STORE_PERMISSION_SEEDS } from '../src/modules/seller-panel/team/store-permissions.js';

const SUBSCRIPTION_PLAN_SEEDS = [
  {
    key: 'free',
    name: 'Free',
    description: 'Explore the platform with core limits.',
    pricePaise: 0,
    billingCycle: 'MONTHLY',
    limits: { 'products.max': 20, 'staff.max': 2, 'orders.monthly': 100 },
    trialDays: 0,
  },
  {
    key: 'starter',
    name: 'Starter',
    description: 'For new stores finding traction.',
    pricePaise: 49900,
    billingCycle: 'MONTHLY',
    limits: { 'products.max': 100, 'staff.max': 5, 'orders.monthly': 1000 },
    trialDays: 14,
  },
  {
    key: 'growth',
    name: 'Growth',
    description: 'For growing catalogs and teams.',
    pricePaise: 149900,
    billingCycle: 'MONTHLY',
    limits: { 'products.max': 1000, 'staff.max': 15, 'orders.monthly': 10000 },
    trialDays: 14,
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'For high-volume sellers.',
    pricePaise: 399900,
    billingCycle: 'MONTHLY',
    limits: { 'products.max': 10000, 'staff.max': 50, 'orders.monthly': 100000 },
    trialDays: 14,
  },
] as const;

async function seedCatalog(): Promise<void> {
  const prisma = getPrisma();

  // Canonical catalog sync: upsert every known module.action with its
  // label/description. Panel-created custom permissions are left untouched.
  for (const seed of PERMISSION_SEEDS) {
    await prisma.permission.upsert({
      where: { key: seed.key },
      update: {
        module: seed.module,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: seed.isSystem,
        status: 'ACTIVE',
      },
      create: {
        key: seed.key,
        module: seed.module,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: seed.isSystem,
        status: 'ACTIVE',
      },
    });
  }
  // Legacy guard: any compiled key missing from PERMISSION_SEEDS still gets
  // a row (split from key) so old guards never 404 on lookup.
  for (const key of ALL_PERMISSIONS) {
    const known = PERMISSION_SEEDS.some((s) => s.key === key);
    if (known) continue;
    const dot = key.indexOf('.');
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: {
        key,
        module: key.slice(0, dot),
        action: key.slice(dot + 1),
        description: `Grants ${key}`,
      },
    });
  }

  for (const role of ROLE_SEEDS) {
    await prisma.adminRole.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      },
    });
  }

  // Super Admin holds all permissions implicitly; still materialize the
  // rows so permission listings are complete and auditable.
  const permissionRows = await prisma.permission.findMany({ select: { id: true, key: true } });
  const roleRows = await prisma.adminRole.findMany({ select: { id: true, key: true } });
  const permByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
  const roleByKey = new Map(roleRows.map((r) => [r.key, r.id]));

  const grants = new Map<string, string[]>();
  grants.set(SUPER_ADMIN_ROLE_KEY, [...ALL_PERMISSIONS]);
  for (const [roleKey, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    grants.set(roleKey, [...perms]);
  }

  for (const [roleKey, permKeys] of grants) {
    const roleId = roleByKey.get(roleKey);
    if (!roleId) throw new Error(`Role missing after upsert: ${roleKey}`);
    for (const permKey of permKeys) {
      const permissionId = permByKey.get(permKey);
      if (!permissionId) throw new Error(`Permission missing after upsert: ${permKey}`);
      await prisma.adminRolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }

  logger.info(`Seeded ${permissionRows.length} permissions, ${roleRows.length} roles`);

  // Store-domain catalog (resource:action) — global, shared by all stores.
  for (const seed of STORE_PERMISSION_SEEDS) {
    await prisma.storePermission.upsert({
      where: { key: seed.key },
      update: {
        resource: seed.resource,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: true,
      },
      create: {
        key: seed.key,
        resource: seed.resource,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: true,
      },
    });
  }

  // Subscription plans (SaaS billing; payment provider attaches later).
  for (const plan of SUBSCRIPTION_PLAN_SEEDS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        description: plan.description,
        pricePaise: plan.pricePaise,
        billingCycle: plan.billingCycle,
        limits: plan.limits as unknown as object,
        trialDays: plan.trialDays,
        isActive: true,
      },
      create: {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        pricePaise: plan.pricePaise,
        billingCycle: plan.billingCycle,
        limits: plan.limits as unknown as object,
        trialDays: plan.trialDays,
        isActive: true,
      },
    });
  }
  logger.info(
    `Seeded ${STORE_PERMISSION_SEEDS.length} store permissions, ${SUBSCRIPTION_PLAN_SEEDS.length} plans`,
  );
}

async function bootstrapSuperAdmin(): Promise<void> {
  const env = getEnv();
  if (!env.SUPER_ADMIN_EMAIL || !env.SUPER_ADMIN_PASSWORD) {
    logger.info('SUPER_ADMIN_EMAIL/PASSWORD not set — skipping admin bootstrap');
    return;
  }
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(env.SUPER_ADMIN_EMAIL);

  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  if (existing) {
    logger.info(`Super admin already exists: ${emailNormalized} — skipping`);
    return;
  }

  const superRole = await prisma.adminRole.findUnique({
    where: { key: SUPER_ADMIN_ROLE_KEY },
  });
  if (!superRole) throw new Error('super_admin role missing — seed catalog first');

  await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.create({
      data: {
        email: env.SUPER_ADMIN_EMAIL as string,
        emailNormalized,
        name: (env.SUPER_ADMIN_EMAIL as string).split('@')[0] ?? env.SUPER_ADMIN_EMAIL,
        passwordHash: await hashSecret(env.SUPER_ADMIN_PASSWORD as string),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await tx.adminPasswordHistory.create({
      data: { adminId: admin.id, passwordHash: admin.passwordHash },
    });
    await tx.adminRoleAssignment.create({
      data: { adminId: admin.id, roleId: superRole.id },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: admin.id,
        action: 'admin.bootstrap',
        resourceType: 'admin',
        resourceId: admin.id,
        after: { email: emailNormalized, roles: [SUPER_ADMIN_ROLE_KEY] },
      },
    });
  });

  logger.info(`Bootstrapped super admin: ${emailNormalized}`);
}

async function main(): Promise<void> {
  try {
    await seedCatalog();
    await bootstrapSuperAdmin();
  } finally {
    const { disconnectDatabase } = await import('../src/config/db.js');
    await disconnectDatabase();
  }
}

void main().catch((err: unknown) => {
  logger.error('Seed failed', { error: err });
  process.exit(1);
});

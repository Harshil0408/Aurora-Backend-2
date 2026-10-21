import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import { slugify } from '../categories/categories.service.js';
import type {
  AttachItemInput,
  CloneAttributeSetInput,
  CreateAttributeSetInput,
  CreateGroupInput,
  UpdateAttributeSetInput,
  UpdateGroupInput,
  UpdateItemInput,
} from './attribute-sets.schemas.js';

/**
 * Phase 1 — Module 4 — attribute sets (admin-owned).
 *
 * A set pins product attributes into an ordered, grouped bundle. Categories
 * reference ZERO or ONE set (`Category.attributeSetId`); when a category has
 * none, the product form inherits the nearest ANCESTOR's set (own wins).
 * Deletion is blocked while categories still reference the set.
 */

type Db = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

async function slugTaken(client: Db, slug: string, exceptSetId?: string): Promise<boolean> {
  const db = client as Prisma.TransactionClient;
  const row = await db.productAttributeSet.findUnique({ where: { slug } });
  return Boolean(row && row.id !== exceptSetId);
}

async function uniqueSlug(client: Db, base: string, exceptSetId?: string): Promise<string> {
  let candidate = base;
  for (let i = 2; i <= 100; i += 1) {
    if (!(await slugTaken(client, candidate, exceptSetId))) return candidate;
    candidate = `${base.slice(0, 150)}-${i}`;
  }
  throw conflict('Could not mint a unique slug — provide one explicitly');
}

async function getLiveSet(client: Db, id: string) {
  const db = client as Prisma.TransactionClient;
  const row = await db.productAttributeSet.findUnique({ where: { id } });
  if (!row) throw notFound('Attribute set not found');
  return row;
}

export async function listAttributeSets(query: {
  page: number;
  limit: number;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  search?: string | undefined;
}) {
  const prisma = getPrisma();
  const where: Prisma.ProductAttributeSetWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.productAttributeSet.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { items: true, groups: true, categories: true } } },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.productAttributeSet.count({ where }),
  ]);
  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getAttributeSet(id: string) {
  const prisma = getPrisma();
  const row = await prisma.productAttributeSet.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          attribute: {
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
              unit: true,
              required: true,
              status: true,
              _count: { select: { options: true } },
            },
          },
        },
      },
      groups: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
      categories: { select: { id: true, name: true, slug: true, status: true } },
    },
  });
  if (!row) throw notFound('Attribute set not found');
  return row;
}

export async function createAttributeSet(
  input: CreateAttributeSetInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const base = input.slug ? slugify(input.slug) : slugify(input.name);
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, base);
    const created = await tx.productAttributeSet.create({
      data: { name: input.name.trim(), slug, description: input.description?.trim() || null },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set.created',
      resourceType: 'attribute_set',
      resourceId: created.id,
      after: { name: created.name, slug },
      meta,
    });
    return created;
  });
}

export async function updateAttributeSet(
  id: string,
  input: UpdateAttributeSetInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveSet(prisma, id);
  return prisma.$transaction(async (tx) => {
    let slug = row.slug;
    if (input.slug !== undefined || input.name !== undefined) {
      const base = input.slug ? slugify(input.slug) : slugify(input.name ?? row.name);
      if (base !== row.slug) {
        slug = await uniqueSlug(tx, base, id);
      }
    }
    const updated = await tx.productAttributeSet.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(slug !== row.slug ? { slug } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set.updated',
      resourceType: 'attribute_set',
      resourceId: id,
      before: { name: row.name, slug: row.slug },
      after: { name: updated.name, slug: updated.slug },
      meta,
    });
    return updated;
  });
}

export async function setAttributeSetStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveSet(prisma, id);
  if (row.status === status) throw badRequest(`Attribute set is already ${status}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.productAttributeSet.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set.status_changed',
      resourceType: 'attribute_set',
      resourceId: id,
      before: { status: row.status },
      // Deactivation detaches the set from NEW product forms; existing
      // category assignments keep rendering (Module 6 contract).
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

export async function deleteAttributeSet(
  id: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveSet(prisma, id);
  const categories = await prisma.category.count({ where: { attributeSetId: id } });
  if (categories > 0) {
    throw conflict(
      `Attribute set is assigned to ${categories} categories — unassign them before deletion`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.productAttributeSetItem.deleteMany({ where: { attributeSetId: id } });
    await tx.productAttributeGroup.deleteMany({ where: { attributeSetId: id } });
    await tx.productAttributeSet.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set.deleted',
      resourceType: 'attribute_set',
      resourceId: id,
      before: { name: row.name, slug: row.slug },
      after: { deleted: true },
      meta,
    });
    return { id, deleted: true };
  });
}

/**
 * Deep copy: every group and item membership is duplicated, the clone starts
 * INACTIVE (status is the admin's explicit switch) and the slug is minted
 * from `{slug}-copy` or a provided one.
 */
export async function cloneAttributeSet(
  id: string,
  input: CloneAttributeSetInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const source = await prisma.productAttributeSet.findUnique({
    where: { id },
    include: { groups: { orderBy: { displayOrder: 'asc' } }, items: true },
  });
  if (!source) throw notFound('Attribute set not found');
  const base = input.slug ? slugify(input.slug) : slugify(input.name ?? `${source.name} copy`);
  const name = input.name?.trim() ?? `${source.name} copy`;

  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, base);
    const clone = await tx.productAttributeSet.create({
      data: {
        name,
        slug,
        description: source.description,
        status: 'INACTIVE',
      },
    });
    const groupIdByOldId = new Map<string, string>();
    for (const group of source.groups) {
      const createdGroup = await tx.productAttributeGroup.create({
        data: {
          attributeSetId: clone.id,
          name: group.name,
          displayOrder: group.displayOrder,
        },
      });
      groupIdByOldId.set(group.id, createdGroup.id);
    }
    for (const item of source.items) {
      await tx.productAttributeSetItem.create({
        data: {
          attributeSetId: clone.id,
          attributeId: item.attributeId,
          groupId: item.groupId ? (groupIdByOldId.get(item.groupId) ?? null) : null,
          required: item.required,
          displayOrder: item.displayOrder,
        },
      });
    }
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set.cloned',
      resourceType: 'attribute_set',
      resourceId: clone.id,
      after: {
        clonedFromId: source.id,
        name,
        slug,
        groups: source.groups.length,
        items: source.items.length,
      },
      meta,
    });
    return clone;
  });
}

// ─── Groups ────────────────────────────────────────────────────────────────

async function getGroup(client: Db, setId: string, groupId: string) {
  const db = client as Prisma.TransactionClient;
  const group = await db.productAttributeGroup.findUnique({ where: { id: groupId } });
  if (!group || group.attributeSetId !== setId) throw notFound('Group not found');
  return group;
}

export async function createGroup(
  setId: string,
  input: CreateGroupInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  return prisma.$transaction(async (tx) => {
    const dup = await tx.productAttributeGroup.findFirst({
      where: { attributeSetId: setId, name: input.name.trim() },
      select: { id: true },
    });
    if (dup) throw conflict(`Group "${input.name.trim()}" already exists in this set`);
    const created = await tx.productAttributeGroup.create({
      data: {
        attributeSetId: setId,
        name: input.name.trim(),
        displayOrder: input.displayOrder,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_group.created',
      resourceType: 'attribute_set_group',
      resourceId: created.id,
      after: { setId, name: created.name },
      meta,
    });
    return created;
  });
}

export async function updateGroup(
  setId: string,
  groupId: string,
  input: UpdateGroupInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  return prisma.$transaction(async (tx) => {
    const group = await getGroup(tx, setId, groupId);
    const nextName = input.name !== undefined ? input.name.trim() : group.name;
    const dup = await tx.productAttributeGroup.findFirst({
      where: { attributeSetId: setId, name: nextName, id: { not: groupId } },
      select: { id: true },
    });
    if (dup) throw conflict(`Group "${nextName}" already exists in this set`);
    const updated = await tx.productAttributeGroup.update({
      where: { id: groupId },
      data: {
        ...(input.name !== undefined ? { name: nextName } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_group.updated',
      resourceType: 'attribute_set_group',
      resourceId: groupId,
      before: { name: group.name, displayOrder: group.displayOrder },
      after: { name: updated.name, displayOrder: updated.displayOrder },
      meta,
    });
    return updated;
  });
}

export async function deleteGroup(
  setId: string,
  groupId: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  return prisma.$transaction(async (tx) => {
    const group = await getGroup(tx, setId, groupId);
    // Items survive ungrouped (SetNull) — the spec keeps memberships valid.
    await tx.productAttributeGroup.delete({ where: { id: groupId } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_group.deleted',
      resourceType: 'attribute_set_group',
      resourceId: groupId,
      before: { setId, name: group.name },
      after: { itemsUngrouped: true },
      meta,
    });
    return { id: groupId, deleted: true };
  });
}

// ─── Items (memberships) ───────────────────────────────────────────────────

async function validateItemTarget(
  client: Db,
  setId: string,
  attributeId: string,
  groupId: string | null,
): Promise<void> {
  const db = client as Prisma.TransactionClient;
  const attribute = await db.productAttribute.findUnique({ where: { id: attributeId } });
  if (!attribute || attribute.deletedAt) throw notFound('Attribute not found (or deleted)');
  if (attribute.status !== 'ACTIVE') {
    throw badRequest('Only ACTIVE attributes can be attached to a set');
  }
  if (groupId) {
    const group = await db.productAttributeGroup.findUnique({ where: { id: groupId } });
    if (!group || group.attributeSetId !== setId) throw notFound('Group not found');
  }
}

export async function attachItem(
  setId: string,
  input: AttachItemInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  const groupId = input.groupId ?? null;

  return prisma.$transaction(async (tx) => {
    await validateItemTarget(tx, setId, input.attributeId, groupId);
    const dup = await tx.productAttributeSetItem.findUnique({
      where: {
        attributeSetId_attributeId: { attributeSetId: setId, attributeId: input.attributeId },
      },
      select: { id: true },
    });
    if (dup) throw conflict('Attribute is already attached to this set');
    const created = await tx.productAttributeSetItem.create({
      data: {
        attributeSetId: setId,
        attributeId: input.attributeId,
        groupId,
        required: input.required === undefined ? null : input.required,
        displayOrder: input.displayOrder,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_item.attached',
      resourceType: 'attribute_set_item',
      resourceId: created.id,
      after: { setId, attributeId: input.attributeId, groupId, required: created.required },
      meta,
    });
    return created;
  });
}

export async function updateItem(
  setId: string,
  itemId: string,
  input: UpdateItemInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  const item = await prisma.productAttributeSetItem.findUnique({ where: { id: itemId } });
  if (!item || item.attributeSetId !== setId) throw notFound('Set item not found');

  return prisma.$transaction(async (tx) => {
    const groupId = input.groupId !== undefined ? input.groupId : item.groupId;
    if (input.groupId !== undefined) await validateItemTarget(tx, setId, item.attributeId, groupId);
    const updated = await tx.productAttributeSetItem.update({
      where: { id: itemId },
      data: {
        ...(input.groupId !== undefined ? { groupId } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_item.updated',
      resourceType: 'attribute_set_item',
      resourceId: itemId,
      before: {
        groupId: item.groupId,
        required: item.required,
        displayOrder: item.displayOrder,
      },
      after: {
        groupId: updated.groupId,
        required: updated.required,
        displayOrder: updated.displayOrder,
      },
      meta,
    });
    return updated;
  });
}

export async function reorderItems(
  setId: string,
  orders: Array<{ id: string; displayOrder: number }>,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  const ids = orders.map((o) => o.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Duplicate item ids in reorder payload');
  const rows = await prisma.productAttributeSetItem.findMany({
    where: { id: { in: ids }, attributeSetId: setId },
    select: { id: true },
  });
  if (rows.length !== ids.length) throw notFound('One or more items do not belong to this set');

  return prisma.$transaction(async (tx) => {
    for (const order of orders) {
      await tx.productAttributeSetItem.update({
        where: { id: order.id },
        data: { displayOrder: order.displayOrder },
      });
    }
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_items.reordered',
      resourceType: 'attribute_set',
      resourceId: setId,
      after: { orders },
      meta,
    });
    return { setId, reordered: orders.length };
  });
}

export async function detachItem(
  setId: string,
  itemId: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveSet(prisma, setId);
  const item = await prisma.productAttributeSetItem.findUnique({ where: { id: itemId } });
  if (!item || item.attributeSetId !== setId) throw notFound('Set item not found');

  return prisma.$transaction(async (tx) => {
    await tx.productAttributeSetItem.delete({ where: { id: itemId } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute_set_item.detached',
      resourceType: 'attribute_set_item',
      resourceId: itemId,
      before: { setId, attributeId: item.attributeId },
      after: { detached: true },
      meta,
    });
    return { id: itemId, detached: true };
  });
}

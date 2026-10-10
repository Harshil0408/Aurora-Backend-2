import { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import type { CreateAttributeInput, UpdateAttributeInput } from './attributes.schemas.js';

export interface ListAttributesQuery {
  page: number;
  limit: number;
  type?: string | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  search?: string | undefined;
}

export interface AttributeActor {
  adminId: string;
}

/** Paginated catalog; `type` narrows to one lookup (categories, languages, …). */
export async function listAttributes(query: ListAttributesQuery) {
  const prisma = getPrisma();
  const where: Prisma.AttributeWhereInput = {
    ...(query.type ? { type: query.type.trim().toLowerCase() } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { key: { contains: query.search, mode: 'insensitive' } },
            { label: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.attribute.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.attribute.count({ where }),
  ]);
  return { data: rows, total };
}

/** Distinct types with row counts — backs the per-type frontend screens. */
export async function listAttributeTypes() {
  const prisma = getPrisma();
  const groups = await prisma.attribute.groupBy({
    by: ['type'],
    _count: { _all: true },
    orderBy: { type: 'asc' },
  });
  return groups.map((g) => ({ type: g.type, count: g._count._all }));
}

export async function getAttribute(id: string) {
  const prisma = getPrisma();
  const row = await prisma.attribute.findUnique({ where: { id } });
  if (!row) throw notFound('Attribute not found');
  return row;
}

export async function createAttribute(
  input: CreateAttributeInput,
  actor: AttributeActor,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const type = input.type.trim().toLowerCase();
  const key = input.key.trim().toLowerCase();
  const existing = await prisma.attribute.findUnique({
    where: { type_key: { type, key } },
  });
  if (existing) throw conflict('Attribute key already in use for this type');

  return prisma.$transaction(async (tx) => {
    const created = await tx.attribute.create({
      data: {
        type,
        key,
        label: input.label.trim(),
        value: input.value?.trim() || null,
        description: input.description?.trim() || null,
        metadata:
          input.metadata === undefined ? Prisma.DbNull : (input.metadata as Prisma.InputJsonValue),
        sortOrder: input.sortOrder,
        status: 'ACTIVE',
        isSystem: false,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute.created',
      resourceType: 'attribute',
      resourceId: created.id,
      after: { type, key, label: created.label },
      meta,
    });
    return created;
  });
}

export async function updateAttribute(
  id: string,
  input: UpdateAttributeInput,
  actor: AttributeActor,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.attribute.findUnique({ where: { id } });
  if (!row) throw notFound('Attribute not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.attribute.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.value !== undefined ? { value: input.value?.trim() || null } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.metadata !== undefined
          ? {
              metadata:
                input.metadata === null ? Prisma.DbNull : (input.metadata as Prisma.InputJsonValue),
            }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute.updated',
      resourceType: 'attribute',
      resourceId: id,
      before: { label: row.label, value: row.value, sortOrder: row.sortOrder },
      after: { label: updated.label, value: updated.value, sortOrder: updated.sortOrder },
      meta,
    });
    return updated;
  });
}

export async function setAttributeStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: AttributeActor,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.attribute.findUnique({ where: { id } });
  if (!row) throw notFound('Attribute not found');
  if (row.status === status) throw badRequest(`Attribute is already ${status}`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.attribute.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute.status_changed',
      resourceType: 'attribute',
      resourceId: id,
      before: { status: row.status },
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

export async function deleteAttribute(id: string, actor: AttributeActor, meta: RequestMeta) {
  const prisma = getPrisma();
  const row = await prisma.attribute.findUnique({ where: { id } });
  if (!row) throw notFound('Attribute not found');
  if (row.isSystem) throw forbidden('System attributes cannot be deleted');

  await prisma.$transaction(async (tx) => {
    await tx.attribute.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'attribute.deleted',
      resourceType: 'attribute',
      resourceId: id,
      before: { type: row.type, key: row.key, label: row.label },
      meta,
    });
  });
  return { deleted: true };
}

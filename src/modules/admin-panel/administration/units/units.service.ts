import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import type { CreateUnitInput, UpdateUnitInput } from './units.schemas.js';

/**
 * Phase 1 — Module 5 — units of measure (admin-owned).
 *
 * Integrity rules:
 * - a base unit of a dimension is its factor-1 row (kg for MASS, m for
 *   LENGTH, l for VOLUME, piece for QUANTITY) — exactly ONE per dimension;
 * - non-base units must reference an existing base unit of the SAME
 *   dimension;
 * - codes are IMMUTABLE once created: ProductAttribute.allowedUnits and
 *   (Module 6) product weight/dimension fields reference codes as free
 *   strings, so renaming would silently orphan those references.
 */

interface UnitBaseMeta {
  dimension: 'MASS' | 'LENGTH' | 'VOLUME' | 'QUANTITY';
  baseCode: string;
  factor: number;
}

/** Validate base-unit integrity within a dimension. */
async function assertBaseUnit(
  client: Prisma.TransactionClient,
  unit: UnitBaseMeta,
  exceptUnitId?: string,
): Promise<void> {
  if (unit.factor === 1) {
    // This row IS a dimension base: exactly one factor-1 unit may exist in
    // the dimension (it is allowed to be the row being edited).
    const existingBases = await client.unitOfMeasure.findMany({
      where: {
        dimension: unit.dimension,
        factor: 1,
        ...(exceptUnitId ? { id: { not: exceptUnitId } } : {}),
      },
      select: { code: true },
    });
    if (existingBases.length > 0) {
      throw badRequest(`${existingBases[0]?.code} is already the base unit of ${unit.dimension}`);
    }
    return;
  }
  const base = await client.unitOfMeasure.findUnique({ where: { code: unit.baseCode } });
  if (!base || base.id === exceptUnitId) {
    throw badRequest(`Base unit ${unit.baseCode} was not found`);
  }
  if (base.dimension !== unit.dimension) {
    throw badRequest(`Base unit ${unit.baseCode} belongs to dimension ${base.dimension}`);
  }
  if (Number(base.factor) !== 1) {
    throw badRequest(`Base unit ${unit.baseCode} must itself have factor 1`);
  }
}

export async function listUnits(query: {
  page: number;
  limit: number;
  dimension?: 'MASS' | 'LENGTH' | 'VOLUME' | 'QUANTITY' | undefined;
  search?: string | undefined;
}) {
  const prisma = getPrisma();
  const where: Prisma.UnitOfMeasureWhereInput = {
    ...(query.dimension ? { dimension: query.dimension } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.unitOfMeasure.findMany({
      where,
      orderBy: [{ dimension: 'asc' }, { factor: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.unitOfMeasure.count({ where }),
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

export async function createUnit(
  input: CreateUnitInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const dup = await tx.unitOfMeasure.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (dup) throw conflict(`Unit ${input.code} already exists`);
    await assertBaseUnit(tx, {
      dimension: input.dimension,
      baseCode: input.baseCode,
      factor: input.factor,
    });
    const created = await tx.unitOfMeasure.create({
      data: {
        code: input.code,
        name: input.name.trim(),
        dimension: input.dimension,
        baseCode: input.factor === 1 ? input.code : input.baseCode,
        factor: input.factor,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'unit.created',
      resourceType: 'unit_of_measure',
      resourceId: created.id,
      after: { code: created.code, dimension: created.dimension, factor: input.factor },
      meta,
    });
    return created;
  });
}

export async function updateUnit(
  id: string,
  input: UpdateUnitInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.unitOfMeasure.findUnique({ where: { id } });
  if (!row) throw notFound('Unit not found');
  return prisma.$transaction(async (tx) => {
    const passedUpdate: UnitBaseMeta = {
      dimension: input.dimension ?? row.dimension,
      baseCode: input.baseCode ?? row.baseCode,
      factor: input.factor ?? Number(row.factor),
    };
    await assertBaseUnit(tx, passedUpdate, id);
    const updated = await tx.unitOfMeasure.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.dimension !== undefined ? { dimension: input.dimension } : {}),
        ...(input.baseCode !== undefined ? { baseCode: input.baseCode } : {}),
        ...(input.factor !== undefined ? { factor: input.factor } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'unit.updated',
      resourceType: 'unit_of_measure',
      resourceId: id,
      before: { code: row.code, dimension: row.dimension, factor: row.factor },
      after: { code: updated.code, dimension: updated.dimension, factor: updated.factor },
      meta,
    });
    return updated;
  });
}

export async function deleteUnit(id: string, actor: { adminId: string }, meta: RequestMeta) {
  const prisma = getPrisma();
  const row = await prisma.unitOfMeasure.findUnique({ where: { id } });
  if (!row) throw notFound('Unit not found');
  const usableOn = await prisma.productAttribute.count({
    where: { deletedAt: null, allowedUnits: { has: row.code } },
  });
  if (usableOn > 0) {
    throw conflict(
      `Unit ${row.code} is referenced by ${usableOn} product attribute(s) — remove it from their allowed-units lists before deleting`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.unitOfMeasure.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'unit.deleted',
      resourceType: 'unit_of_measure',
      resourceId: id,
      before: { code: row.code, dimension: row.dimension },
      after: { deleted: true },
      meta,
    });
    return { id, deleted: true };
  });
}

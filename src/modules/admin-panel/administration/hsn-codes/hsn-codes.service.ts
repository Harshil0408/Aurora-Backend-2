import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import type { CreateHsnCodeInput, UpdateHsnCodeInput } from './hsn-codes.schemas.js';

/**
 * Phase 1 — Module 5 — HSN/SAC master (admin-owned). Codes may be renamed
 * freely UNIQUELY; the checkout engine snapshots the code string per order
 * line for invoice immutability, so edits never corrupt historic invoices.
 */

export async function listHsnCodes(query: {
  page: number;
  limit: number;
  kind?: 'HSN' | 'SAC' | undefined;
  search?: string | undefined;
}) {
  const prisma = getPrisma();
  const where: Prisma.HsnCodeWhereInput = {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.hsnCode.findMany({
      where,
      orderBy: [{ code: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.hsnCode.count({ where }),
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

export async function createHsnCode(
  input: CreateHsnCodeInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const dup = await tx.hsnCode.findUnique({ where: { code: input.code }, select: { id: true } });
    if (dup) throw conflict(`HSN/SAC code ${input.code} already exists`);
    const created = await tx.hsnCode.create({
      data: {
        kind: input.kind,
        code: input.code,
        description: input.description?.trim() || null,
        gstRatePercent: input.gstRatePercent ?? null,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'hsn_code.created',
      resourceType: 'hsn_code',
      resourceId: created.id,
      after: { kind: created.kind, code: created.code },
      meta,
    });
    return created;
  });
}

export async function updateHsnCode(
  id: string,
  input: UpdateHsnCodeInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.hsnCode.findUnique({ where: { id } });
  if (!row) throw notFound('HSN/SAC code not found');
  return prisma.$transaction(async (tx) => {
    const nextCode = input.code !== undefined ? input.code : row.code;
    if (nextCode !== row.code) {
      const dup = await tx.hsnCode.findUnique({ where: { code: nextCode }, select: { id: true } });
      if (dup) throw conflict(`HSN/SAC code ${nextCode} already exists`);
    }
    const updated = await tx.hsnCode.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: nextCode } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.gstRatePercent !== undefined ? { gstRatePercent: input.gstRatePercent } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'hsn_code.updated',
      resourceType: 'hsn_code',
      resourceId: id,
      before: { code: row.code },
      after: { code: updated.code },
      meta,
    });
    return updated;
  });
}

export async function deleteHsnCode(id: string, actor: { adminId: string }, meta: RequestMeta) {
  const prisma = getPrisma();
  const row = await prisma.hsnCode.findUnique({ where: { id } });
  if (!row) throw notFound('HSN/SAC code not found');
  return prisma.$transaction(async (tx) => {
    await tx.hsnCode.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'hsn_code.deleted',
      resourceType: 'hsn_code',
      resourceId: id,
      before: { kind: row.kind, code: row.code },
      after: { deleted: true },
      meta,
    });
    return { id, deleted: true };
  });
}

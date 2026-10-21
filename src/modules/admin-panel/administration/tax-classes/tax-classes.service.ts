import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import { quoteTax, type TaxQuoteResult } from '../../../../shared/commerce/quote.js';
import { getSettings } from '../commerce-settings/commerce-settings.service.js';
import type {
  CreateTaxClassInput,
  CreateTaxRateInput,
  QuoteInput,
  UpdateTaxClassInput,
  UpdateTaxRateInput,
} from './tax-classes.schemas.js';

/**
 * Phase 1 — Module 5 — tax classes (admin-owned).
 *
 * GST classes named per slab ('GST 18%', 'GST 5% — essentials'…) own regional
 * rate rows: the 'ALL' row is the nationwide headline, per-state rows
 * override it for special-category states. Rate rows are pure DATA — the
 * CGST/SGST/IGST split is derived by the pure quote engine at consumption
 * time, so a state override never changes the invoice component structure.
 */

async function getLiveClass(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  id: string,
) {
  const db = client as Prisma.TransactionClient;
  const row = await db.taxClass.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Tax class not found');
  return row;
}

export async function listTaxClasses(query: {
  page: number;
  limit: number;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  search?: string | undefined;
}) {
  const prisma = getPrisma();
  const where: Prisma.TaxClassWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.taxClass.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        _count: { select: { categories: true } },
        rates: { orderBy: [{ region: 'asc' }] },
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.taxClass.count({ where }),
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

export async function getTaxClass(id: string) {
  const prisma = getPrisma();
  const row = await prisma.taxClass.findUnique({
    where: { id },
    include: {
      rates: { orderBy: [{ region: 'asc' }] },
      categories: { select: { id: true, name: true, slug: true, status: true } },
      _count: { select: { categories: true } },
    },
  });
  if (!row || row.deletedAt) throw notFound('Tax class not found');
  return row;
}

export async function createTaxClass(
  input: CreateTaxClassInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const dup = await tx.taxClass.findFirst({
      where: { name: input.name.trim() },
      select: { id: true },
    });
    if (dup) throw conflict(`Tax class "${input.name.trim()}" already exists`);
    const created = await tx.taxClass.create({
      data: { name: input.name.trim(), description: input.description?.trim() || null },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_class.created',
      resourceType: 'tax_class',
      resourceId: created.id,
      after: { name: created.name },
      meta,
    });
    return created;
  });
}

export async function updateTaxClass(
  id: string,
  input: UpdateTaxClassInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveClass(prisma, id);
  return prisma.$transaction(async (tx) => {
    const nextName = input.name !== undefined ? input.name.trim() : row.name;
    const dup = await tx.taxClass.findFirst({
      where: { name: nextName, id: { not: id } },
      select: { id: true },
    });
    if (dup) throw conflict(`Tax class "${nextName}" already exists`);
    const updated = await tx.taxClass.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: nextName } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_class.updated',
      resourceType: 'tax_class',
      resourceId: id,
      before: { name: row.name },
      after: { name: updated.name },
      meta,
    });
    return updated;
  });
}

export async function setTaxClassStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveClass(prisma, id);
  if (row.status === status) throw badRequest(`Tax class is already ${status}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.taxClass.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_class.status_changed',
      resourceType: 'tax_class',
      resourceId: id,
      before: { status: row.status },
      // INACTIVE hides the class from pickers and blocks NEW quotes; the
      // checkout engine snapshots values per order line, so existing
      // catalog references keep rendering (Module 6 contract).
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

export async function deleteTaxClass(id: string, actor: { adminId: string }, meta: RequestMeta) {
  const prisma = getPrisma();
  const row = await getLiveClass(prisma, id);
  const categories = await prisma.category.count({ where: { taxClassId: id, deletedAt: null } });
  if (categories > 0) {
    throw conflict(
      `Tax class is the default for ${categories} categories — re-point those categories before deleting it`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.taxRate.deleteMany({ where: { taxClassId: id } });
    await tx.taxClass.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_class.deleted',
      resourceType: 'tax_class',
      resourceId: id,
      before: { name: row.name },
      after: { deleted: true },
      meta,
    });
    return { id, deleted: true };
  });
}

// ─── Rates (per-class regional rows) ───────────────────────────────────────

async function getRate(client: Prisma.TransactionClient, classId: string, rateId: string) {
  const rate = await client.taxRate.findUnique({ where: { id: rateId } });
  if (!rate || rate.taxClassId !== classId) throw notFound('Rate row not found');
  return rate;
}

export async function createTaxRate(
  classId: string,
  input: CreateTaxRateInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const dup = await tx.taxRate.findUnique({
      where: { taxClassId_region: { taxClassId: classId, region: input.region } },
      select: { id: true },
    });
    if (dup) throw conflict(`Rate for region ${input.region} already exists on this class`);
    const created = await tx.taxRate.create({
      data: {
        taxClassId: classId,
        region: input.region,
        ratePercent: input.ratePercent,
        cessPercent: input.cessPercent,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_rate.created',
      resourceType: 'tax_rate',
      resourceId: created.id,
      after: {
        taxClassId: classId,
        region: input.region,
        ratePercent: input.ratePercent,
        cessPercent: input.cessPercent,
      },
      meta,
    });
    return created;
  });
}

export async function updateTaxRate(
  classId: string,
  rateId: string,
  input: UpdateTaxRateInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveClass(prisma, classId);
  return prisma.$transaction(async (tx) => {
    const rate = await getRate(tx, classId, rateId);
    const updated = await tx.taxRate.update({
      where: { id: rateId },
      data: {
        ...(input.ratePercent !== undefined ? { ratePercent: input.ratePercent } : {}),
        ...(input.cessPercent !== undefined ? { cessPercent: input.cessPercent } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_rate.updated',
      resourceType: 'tax_rate',
      resourceId: rateId,
      before: { region: rate.region, ratePercent: rate.ratePercent, cessPercent: rate.cessPercent },
      after: {
        region: updated.region,
        ratePercent: updated.ratePercent,
        cessPercent: updated.cessPercent,
      },
      meta,
    });
    return updated;
  });
}

export async function deleteTaxRate(
  classId: string,
  rateId: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveClass(prisma, classId);
  return prisma.$transaction(async (tx) => {
    const rate = await getRate(tx, classId, rateId);
    await tx.taxRate.delete({ where: { id: rateId } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'tax_rate.deleted',
      resourceType: 'tax_rate',
      resourceId: rateId,
      before: { region: rate.region, ratePercent: rate.ratePercent },
      after: { deleted: true },
      meta,
    });
    return { id: rateId, deleted: true };
  });
}

// ─── Quote preview (checkout engine will move into the orders module) ──────

/**
 * Resolve the effective rate row for a buyer state: exact state row wins,
 * the 'ALL' row is the nationwide fallback, no row at all is a 400 so the
 * admin sees misconfigured classes immediately.
 */
async function effectiveRate(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  taxClassId: string,
  buyerState: string,
) {
  const db = client as Prisma.TransactionClient;
  const rows = await db.taxRate.findMany({ where: { taxClassId } });
  const exact = rows.find((r) => r.region === buyerState);
  const nationwide = rows.find((r) => r.region === 'ALL');
  const row = exact ?? nationwide;
  if (!row) {
    throw badRequest(`Tax class has no rate configured for ${buyerState} and no 'ALL' fallback`);
  }
  return row;
}

/** RoundingMode enum → quote-engine mode string. */
function toQuoteRounding(mode: string): 'none' | 'half-up' | 'rup' {
  switch (mode) {
    case 'ROUND_HALF_UP':
      return 'half-up';
    case 'ROUND_UP_TO_RUPEE':
      return 'rup';
    default:
      return 'none';
  }
}

export async function quoteTaxPreview(
  input: QuoteInput,
): Promise<TaxQuoteResult & { preview: true }> {
  const prisma = getPrisma();
  const klass = await getLiveClass(prisma, input.taxClassId);
  if (klass.status !== 'ACTIVE') throw badRequest('Tax class is not ACTIVE');
  const buyerState = input.buyerState ?? input.sellerState;
  const rate = await effectiveRate(prisma, input.taxClassId, buyerState);
  const settings = await getSettings();
  // Platform default; a per-store override arrives with store settings (Module 6).
  const inclusive = input.inclusive ?? settings.priceIncludesTax;
  const quote = quoteTax({
    amount: input.amount,
    ratePercent: Number(rate.ratePercent),
    cessPercent: Number(rate.cessPercent),
    sameState: input.sellerState === buyerState,
    inclusive,
    rounding: input.rounding ?? toQuoteRounding(settings.roundingMode),
  });
  return { ...quote, preview: true };
}

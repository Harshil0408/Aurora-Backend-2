import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordStoreAudit } from '../../activity/store-audit.service.js';
import type { ApplyBrandAccessInput, CreateBrandRequestInput } from './brands.schemas.js';

/**
 * Phase 1 — Module 3 — seller face of the brand master.
 *
 * Sellers browse an ACTIVE, deduped brand list carrying a per-store access
 * state (`open` | `restricted` | `pending` | `granted` | `expired`) so the
 * product form (Module 6) can gate selection exactly like categories.
 * Requests and authorisation applications are store-scoped and audited
 * like every other mutation. "Unbranded / Generic" is a picker concern —
 * products with no brand simply leave brandId null (Module 6).
 */

export type BrandAccess = 'open' | 'restricted' | 'pending' | 'granted' | 'expired';

function accessState(
  restricted: boolean,
  auth: { status: string; expiresAt: Date | null } | undefined,
): BrandAccess {
  if (!restricted) return 'open';
  if (!auth) return 'restricted';
  if (auth.status === 'APPROVED') {
    if (auth.expiresAt && auth.expiresAt.getTime() <= Date.now()) return 'expired';
    return 'granted';
  }
  if (auth.status === 'PENDING') return 'pending';
  return 'restricted';
}

export interface SellerBrandRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  website: string | null;
  country: string | null;
  restricted: boolean;
  access: BrandAccess;
  authorisationExpiresAt: string | null;
}

async function assertProofDocuments(storeId: string, assetIds: string[]): Promise<void> {
  const assets = await getPrisma().storeMediaAsset.findMany({
    where: { storeId, id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    throw badRequest('One or more documents do not belong to this store');
  }
  const nonDocs = assets.filter((a) => a.kind !== 'DOCUMENT');
  if (nonDocs.length > 0) throw badRequest('Ownership proofs must be PDF documents');
}

export async function getSellerBrandList(
  storeId: string,
  query: {
    page: number;
    limit: number;
    search?: string | undefined;
    openOnly?: boolean | undefined;
  },
): Promise<{
  data: SellerBrandRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const prisma = getPrisma();
  const where = {
    status: 'ACTIVE' as const,
    deletedAt: null,
    mergedIntoId: null,
    ...(query.openOnly ? { restricted: false } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { slug: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [brands, total, auths] = await Promise.all([
    prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        website: true,
        country: true,
        restricted: true,
      },
    }),
    prisma.brand.count({ where }),
    prisma.brandAuthorization.findMany({
      where: { storeId, status: { in: ['PENDING', 'APPROVED'] } },
      select: { brandId: true, status: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  // Newest authorisation row per brand (re-application supersedes history).
  const byBrand = new Map<string, { status: string; expiresAt: Date | null }>();
  for (const a of auths) if (!byBrand.has(a.brandId)) byBrand.set(a.brandId, a);
  const data = brands.map((b) => {
    const auth = byBrand.get(b.id);
    const state = accessState(b.restricted, auth);
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      logoUrl: b.logoUrl,
      website: b.website,
      country: b.country,
      restricted: b.restricted,
      access: state,
      authorisationExpiresAt: auth?.expiresAt?.toISOString() ?? null,
    };
  });
  // Access state travels with every row so the product form (Module 6)
  // can gate restricted selection without a second round-trip.
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
/**
 * Single-source access resolver for Module 6: publish requires `granted`
 * (or an open brand). Throws nothing — callers map the state to UX.
 */
export async function getBrandAccess(storeId: string, brandId: string): Promise<BrandAccess> {
  const prisma = getPrisma();
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.deletedAt) throw notFound('Brand not found');
  const auth = await prisma.brandAuthorization.findFirst({
    where: { storeId, brandId, status: { in: ['PENDING', 'APPROVED'] } },
    orderBy: { createdAt: 'desc' },
  });
  return accessState(brand.restricted, auth ?? undefined);
}

export async function createBrandRequest(
  storeId: string,
  sellerId: string,
  actorEmail: string | null,
  input: CreateBrandRequestInput,
  reqMeta: RequestMeta,
) {
  const prisma = getPrisma();
  // Fast-fail on an existing active brand so sellers don't queue requests
  // that an admin would just link to the master row.
  const existing = await prisma.brand.findFirst({
    where: {
      deletedAt: null,
      mergedIntoId: null,
      OR: [{ name: { equals: input.name.trim(), mode: 'insensitive' } }],
    },
    select: { id: true, name: true, slug: true },
  });
  if (existing) {
    throw conflict(
      `Brand "${existing.name}" already exists on the marketplace — select it instead`,
    );
  }
  await assertProofDocuments(storeId, input.proofAssetIds);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.brandRequest.create({
      data: {
        storeId,
        sellerId,
        name: input.name.trim(),
        website: input.website?.trim() || null,
        justification: input.justification.trim(),
        proofAssetIds: input.proofAssetIds,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'brand.requested',
      resourceType: 'brand_request',
      resourceId: row.id,
      metadata: {
        name: row.name,
        proofs: input.proofAssetIds.length,
        logoUrl: input.logoUrl ?? null,
      },
      meta: reqMeta,
    });
    return row;
  });
  return created;
}

export async function listBrandRequests(
  storeId: string,
  status?: 'PENDING' | 'APPROVED' | 'REJECTED',
) {
  const prisma = getPrisma();
  return prisma.brandRequest.findMany({
    where: { storeId, ...(status ? { status } : {}) },
    include: { resolvedBrand: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAuthorisations(
  storeId: string,
  status?: 'PENDING' | 'APPROVED' | 'REJECTED',
) {
  const prisma = getPrisma();
  return prisma.brandAuthorization.findMany({
    where: { storeId, ...(status ? { status } : {}) },
    include: { brand: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function applyForAuthorisation(
  storeId: string,
  brandId: string,
  sellerId: string,
  actorEmail: string | null,
  input: ApplyBrandAccessInput,
  reqMeta: RequestMeta,
) {
  const prisma = getPrisma();
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.deletedAt || brand.status !== 'ACTIVE' || brand.mergedIntoId) {
    throw notFound('Brand not found');
  }
  if (!brand.restricted) throw badRequest('This brand is open — no authorisation needed');

  // Approved-but-expired grants allow fresh applications; reopen instead
  // of duplicating so review state never sits twice in the queue.
  const existing = await prisma.brandAuthorization.findFirst({
    where: {
      storeId,
      brandId,
      OR: [
        { status: 'PENDING' },
        {
          status: 'APPROVED',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      ],
    },
  });
  if (existing) {
    throw conflict(
      existing.status === 'APPROVED'
        ? 'Authorisation is already granted for this brand'
        : 'An authorisation application is already pending review',
    );
  }
  await assertProofDocuments(storeId, input.documentAssetIds);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.brandAuthorization.create({
      data: {
        storeId,
        brandId,
        documentAssetIds: input.documentAssetIds,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'brand.access_requested',
      resourceType: 'brand_authorization',
      resourceId: row.id,
      metadata: {
        brandId,
        brandName: brand.name,
        documents: input.documentAssetIds.length,
        note: input.note ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      meta: reqMeta,
    });
    return row;
  });
  return created;
}

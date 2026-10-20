import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import { slugify } from '../categories/categories.service.js';
import type { CreateBrandInput, UpdateBrandInput } from './brands.schemas.js';

/**
 * Phase 1 — Module 3 — brand master (admin-owned, seller-consumed).
 *
 * Invariants mirror Module 2: slugs globally unique across live brands AND
 * retired redirect rows (a slug, once retired by a rename/merge, stays
 * reserved as a permanent redirect target). Merging re-points authorisations
 * and redirects, then soft-deletes the duplicate with `mergedIntoId`.
 * Products never ride a merged id — the Module 6 product attachments must
 * read the surviving brand (the seller merge flow re-assigns in Module 6).
 *
 * Restricted brands gate publishing behind a per-store approved
 * authorisation; expiry is surfaced by access helpers and enforced by the
 * auto-unpublish sweep that ships with the product scheduler (Module 6+).
 */

function clean<T extends string>(v: T | undefined): T | undefined {
  return v === undefined ? undefined : (v.trim() as T);
}

const urlOrNull = (v: string | undefined): string | null => clean(v) || null;

async function slugTaken(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  slug: string,
  exceptBrandId?: string,
): Promise<boolean> {
  const db = client as Prisma.TransactionClient;
  const [brand, redir] = await Promise.all([
    db.brand.findUnique({ where: { slug } }),
    db.brandRedirect.findUnique({ where: { slug } }),
  ]);
  if (brand && brand.id !== exceptBrandId) return true;
  if (redir && redir.brandId !== exceptBrandId) return true;
  return false;
}

async function uniqueSlug(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  base: string,
  exceptBrandId?: string,
): Promise<string> {
  let candidate = base;
  for (let i = 2; i <= 100; i += 1) {
    if (!(await slugTaken(client, candidate, exceptBrandId))) return candidate;
    candidate = `${base.slice(0, 150)}-${i}`;
  }
  throw conflict('Could not mint a unique slug — provide one explicitly');
}

async function getLiveBrand(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  id: string,
) {
  const db = client as Prisma.TransactionClient;
  const row = await db.brand.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Brand not found');
  return row;
}

export async function listBrands(query: {
  page: number;
  limit: number;
  search?: string | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  restricted?: boolean | undefined;
  featured?: boolean | undefined;
  includeDeleted?: boolean;
}) {
  const prisma = getPrisma();
  const where: Prisma.BrandWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.restricted !== undefined ? { restricted: query.restricted } : {}),
    ...(query.featured !== undefined ? { featured: query.featured } : {}),
    ...(query.includeDeleted ? {} : { deletedAt: null }),
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
    prisma.brand.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.brand.count({ where }),
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

export async function getBrand(id: string) {
  const prisma = getPrisma();
  const row = await prisma.brand.findUnique({
    where: { id },
    include: {
      redirects: true,
      authorisations: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { store: { select: { id: true, name: true, slug: true } } },
      },
    },
  });
  if (!row || row.deletedAt) throw notFound('Brand not found');
  return row;
}

export async function createBrand(
  input: CreateBrandInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const base = input.slug ? slugify(input.slug) : slugify(input.name);
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, base);
    const created = await tx.brand.create({
      data: {
        name: input.name.trim(),
        slug,
        logoUrl: urlOrNull(input.logoUrl),
        bannerUrl: urlOrNull(input.bannerUrl),
        description: urlOrNull(input.description),
        website: urlOrNull(input.website),
        country: clean(input.country) || null,
        restricted: input.restricted,
        featured: input.featured,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'brand.created',
      resourceType: 'brand',
      resourceId: created.id,
      after: { name: created.name, slug, restricted: created.restricted },
      meta,
    });
    return created;
  });
}

export async function updateBrand(
  id: string,
  input: UpdateBrandInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveBrand(prisma, id);
  return prisma.$transaction(async (tx) => {
    let slug = row.slug;
    if (input.slug !== undefined || input.name !== undefined) {
      const base = input.slug ? slugify(input.slug) : slugify(input.name ?? row.name);
      if (base !== row.slug) {
        slug = await uniqueSlug(tx, base, id);
        // Retire the old slug as a permanent redirect — never reusable.
        await tx.brandRedirect.upsert({
          where: { slug: row.slug },
          update: { brandId: id },
          create: { slug: row.slug, brandId: id },
        });
      }
    }
    const updated = await tx.brand.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(slug !== row.slug ? { slug } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: urlOrNull(input.logoUrl) } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: urlOrNull(input.bannerUrl) } : {}),
        ...(input.description !== undefined ? { description: urlOrNull(input.description) } : {}),
        ...(input.website !== undefined ? { website: urlOrNull(input.website) } : {}),
        ...(input.country !== undefined ? { country: clean(input.country) || null } : {}),
        ...(input.restricted !== undefined ? { restricted: input.restricted } : {}),
        ...(input.featured !== undefined ? { featured: input.featured } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'brand.updated',
      resourceType: 'brand',
      resourceId: id,
      before: { name: row.name, slug: row.slug },
      after: { name: updated.name, slug: updated.slug },
      meta,
    });
    return updated;
  });
}

export async function setBrandStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveBrand(prisma, id);
  if (row.status === status) throw badRequest(`Brand is already ${status}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.brand.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'brand.status_changed',
      resourceType: 'brand',
      resourceId: id,
      before: { status: row.status },
      // Deactivation hides the brand from seller listings + storefront.
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

/**
 * Consolidate duplicates: re-point authorisations and pending-request
 * resolutions to the surviving brand, retire every slug (own + redirect
 * aliases) as redirect rows to the target, then soft-delete with
 * `mergedIntoId`. The target must be live; this id is then retired.
 */
export async function mergeBrand(
  id: string,
  targetId: string,
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const source = await getLiveBrand(prisma, id);
  const target = await getLiveBrand(prisma, targetId);
  if (id === targetId) throw badRequest('A brand cannot merge into itself');
  if (target.mergedIntoId) throw conflict('Target brand is itself merged into another brand');

  return prisma.$transaction(async (tx) => {
    // Authorisation history moves with the merge so approved stores keep
    // their access under the surviving brand.
    await tx.brandAuthorization.updateMany({
      where: { brandId: id },
      data: { brandId: targetId },
    });
    await tx.brandRequest.updateMany({
      where: { resolvedBrandId: id },
      data: { resolvedBrandId: targetId },
    });
    // Retire every slug that used to resolve here (own slug stays live in
    // the redirect row; zero window where the old URL 404s).
    const retained = await tx.brandRedirect.findMany({ where: { brandId: id } });
    await tx.brandRedirect.updateMany({ where: { brandId: id }, data: { brandId: targetId } });
    const retiredSlug = source.slug !== target.slug ? source.slug : null;
    if (retained.some((r) => r.slug === source.slug)) {
      throw conflict('Slug redirect conflict while merging — check brand_redirects');
    }
    if (retiredSlug) {
      await tx.brandRedirect.upsert({
        where: { slug: source.slug },
        update: { brandId: targetId },
        create: { slug: source.slug, brandId: targetId },
      });
    }
    const merged = await tx.brand.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE', mergedIntoId: targetId },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'brand.merged',
      resourceType: 'brand',
      resourceId: id,
      before: { name: source.name, slug: source.slug },
      after: {
        mergedIntoId: targetId,
        targetName: target.slug,
        reason,
        retargetedAuthorisations: true,
        retiredRedirectSlug: retiredSlug,
      },
      meta,
    });
    return merged;
  });
}

// ─── Seller request + authorisation queues ───────────────────────────────

export async function listBrandRequests(query: {
  page: number;
  limit: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const prisma = getPrisma();
  const where: Prisma.BrandRequestWhereInput = { status: query.status };
  const [data, total] = await Promise.all([
    prisma.brandRequest.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        resolvedBrand: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.brandRequest.count({ where }),
  ]);
  return { data, total };
}

export async function reviewBrandRequest(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  reviewNote: string | undefined,
  resolvedBrandId: string | null | undefined,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.brandRequest.findUnique({ where: { id } });
  if (!row) throw notFound('Request not found');
  if (row.status !== 'PENDING') throw badRequest('Request already decided');
  if (decision === 'APPROVED' && resolvedBrandId) {
    const target = await prisma.brand.findUnique({ where: { id: resolvedBrandId } });
    if (!target || target.deletedAt) throw badRequest('Resolved brand not found');
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.brandRequest.update({
      where: { id },
      data: {
        status: decision,
        reviewNote: reviewNote?.trim() || null,
        resolvedBrandId: resolvedBrandId ?? null,
        reviewedById: actor.adminId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: decision === 'APPROVED' ? 'brand.request_approved' : 'brand.request_rejected',
      resourceType: 'brand_request',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { decision, resolvedBrandId: resolvedBrandId ?? null },
      meta,
    });
    return updated;
  });
}

export async function listBrandAuthorisations(query: {
  page: number;
  limit: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const prisma = getPrisma();
  const where: Prisma.BrandAuthorizationWhereInput = { status: query.status };
  const [data, total] = await Promise.all([
    prisma.brandAuthorization.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true, restricted: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.brandAuthorization.count({ where }),
  ]);
  return { data, total };
}

export async function reviewBrandAuthorisation(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  reviewNote: string | undefined,
  expiresAt: string | null | undefined,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.brandAuthorization.findUnique({ where: { id } });
  if (!row) throw notFound('Application not found');
  if (row.status !== 'PENDING') throw badRequest('Application already decided');
  const expiry = expiresAt === undefined ? row.expiresAt : expiresAt ? new Date(expiresAt) : null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.brandAuthorization.update({
      where: { id },
      data: {
        status: decision,
        reviewNote: reviewNote?.trim() || null,
        expiresAt: expiry,
        reviewedById: actor.adminId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: decision === 'APPROVED' ? 'brand.access_approved' : 'brand.access_rejected',
      resourceType: 'brand_authorization',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { decision, expiresAt: expiry?.toISOString() ?? null },
      meta,
    });
    return updated;
  });
}

// ─── Bulk import / export ─────────────────────────────────────────────────

export interface ImportPreview {
  creates: number;
  updates: number;
  errors: Array<{ row: number; message: string }>;
  committed: boolean;
}

export async function importBrands(
  rows: Array<Record<string, unknown>>,
  mode: 'validate' | 'commit',
  actor: { adminId: string },
  meta: RequestMeta,
): Promise<ImportPreview> {
  const prisma = getPrisma();
  const errors: ImportPreview['errors'] = [];
  let creates = 0;
  let updates = 0;

  // Slug pre-pass (same shape as the category import) so every slug failure
  // is reported upfront and duplicate slugs INSIDE the file collide on row 2.
  const plannedSlugs = new Map<number, string>();
  for (let i = 0; i < rows.length; i += 1) {
    const rowNum = i + 1;
    try {
      const name = String(rows[i]?.['name'] ?? '').trim();
      if (name.length < 2) throw new Error('name is required (min 2 chars)');
      plannedSlugs.set(rowNum, slugify(rows[i]?.['slug'] ? String(rows[i]!['slug']) : name));
    } catch (err) {
      errors.push({ row: rowNum, message: err instanceof Error ? err.message : 'Invalid row' });
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const rowNum = i + 1;
    if (errors.some((e) => e.row === rowNum)) continue;
    const row = rows[i] ?? {};
    try {
      const name = String(row['name'] ?? '').trim();
      if (name.length < 2) throw new Error('name is required (min 2 chars)');
      const slug = plannedSlugs.get(rowNum) as string;
      // In-file duplicate slugs (this file defines the same slug twice).
      const firstUseRow = [...plannedSlugs.entries()].find(([, s]) => s === slug)?.[0];
      if (firstUseRow !== undefined && firstUseRow !== rowNum) {
        throw new Error(`duplicate slug in file: ${slug} (also row ${firstUseRow})`);
      }
      const existing = await prisma.brand.findFirst({ where: { slug } });
      if (existing && !existing.deletedAt) updates += 1;
      else if (!existing) creates += 1;
      else creates += 1; // retired-slug collision: create after explicit rename

      if (mode === 'commit') {
        await prisma.$transaction(async (tx) => {
          if (existing && !existing.deletedAt) {
            const patch: Prisma.BrandUpdateInput = { name };
            if (row['description']) patch.description = String(row['description']).slice(0, 2000);
            if (row['website']) patch.website = String(row['website']).slice(0, 512);
            if (row['country']) patch.country = String(row['country']).slice(0, 64);
            if (row['status'] === 'INACTIVE') patch.status = 'INACTIVE';
            if (row['restricted'] !== undefined) patch.restricted = Boolean(row['restricted']);
            if (row['featured'] !== undefined) patch.featured = Boolean(row['featured']);
            await tx.brand.update({ where: { id: existing.id }, data: patch });
          } else {
            const finalSlug = existing ? await uniqueSlug(tx, slug) : slug;
            if (await slugTaken(tx, finalSlug)) throw new Error(`slug retired: ${slug}`);
            await tx.brand.create({
              data: {
                name,
                slug: finalSlug,
                description: row['description'] ? String(row['description']).slice(0, 2000) : null,
                website: row['website'] ? String(row['website']).slice(0, 512) : null,
                country: row['country'] ? String(row['country']).slice(0, 64) : null,
                status: row['status'] === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                restricted: Boolean(row['restricted']),
                featured: Boolean(row['featured']),
              },
            });
          }
          await recordAudit(tx, {
            actorId: actor.adminId,
            action: 'brand.imported',
            resourceType: 'brand',
            resourceId: slug,
            after: { row: rowNum, mode: 'commit' },
            meta,
          });
        });
      }
    } catch (err) {
      errors.push({ row: rowNum, message: err instanceof Error ? err.message : 'Invalid row' });
    }
  }
  return { creates, updates, errors, committed: mode === 'commit' };
}

export async function exportBrands(): Promise<Array<Record<string, unknown>>> {
  const prisma = getPrisma();
  const rows = await prisma.brand.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return rows.map((b) => ({
    name: b.name,
    slug: b.slug,
    description: b.description ?? '',
    website: b.website ?? '',
    country: b.country ?? '',
    status: b.status,
    restricted: b.restricted,
    featured: b.featured,
  }));
}

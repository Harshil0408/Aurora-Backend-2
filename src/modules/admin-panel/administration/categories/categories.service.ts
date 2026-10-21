import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './categories.schemas.js';

/**
 * Phase 1 · Module 2 — product category tree (admin-owned).
 *
 * Invariants: slugs globally unique across live categories AND retired
 * redirects; parent links never cycle; soft-delete keeps history while
 * hiding nodes from sellers. Deactivation hides products storefront-side
 * (Module 18 reads `status`); the product-existence delete guard lands
 * with the Product model in Module 6 (children guard ships now).
 */

export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  if (slug.length < 2) throw badRequest('Name produces an empty slug — provide one explicitly');
  return slug;
}

async function slugTaken(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  slug: string,
  exceptCategoryId?: string,
): Promise<boolean> {
  const db = client as Prisma.TransactionClient;
  const [cat, redir] = await Promise.all([
    db.category.findUnique({ where: { slug } }),
    db.categoryRedirect.findUnique({ where: { slug } }),
  ]);
  if (cat && cat.id !== exceptCategoryId) return true;
  if (redir && redir.categoryId !== exceptCategoryId) return true;
  return false;
}

async function uniqueSlug(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  base: string,
  exceptCategoryId?: string,
): Promise<string> {
  let candidate = base;
  for (let i = 2; i <= 100; i += 1) {
    if (!(await slugTaken(client, candidate, exceptCategoryId))) return candidate;
    candidate = `${base.slice(0, 150)}-${i}`;
  }
  throw conflict('Could not mint a unique slug — provide one explicitly');
}

/** Module 4 landed the attribute-set FK — references must resolve. */
async function assertAttributeSet(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  attributeSetId: string | null | undefined,
): Promise<void> {
  if (!attributeSetId) return;
  const db = client as Prisma.TransactionClient;
  const set = await db.productAttributeSet.findUnique({
    where: { id: attributeSetId },
    select: { status: true },
  });
  if (!set) throw badRequest('Attribute set not found');
  if (set.status !== 'ACTIVE') throw badRequest('Attribute set is not ACTIVE');
}

/** Walk ancestors to reject cycles; throws on missing parent. */
async function assertValidParent(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  selfId: string | null,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  const db = client as Prisma.TransactionClient;
  const parent = await db.category.findUnique({ where: { id: parentId } });
  if (!parent || parent.deletedAt) throw badRequest('Parent category not found');
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === selfId) throw badRequest('A category cannot live under itself or its descendants');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    if (seen.size > 500) throw badRequest('Category tree too deep to re-parent safely');
    const node: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = node?.parentId ?? null;
  }
}

function clean<T extends string>(v: T | undefined): T | undefined {
  return v === undefined ? undefined : (v.trim() as T);
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  icon: string | null;
  displayOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  showInNav: boolean;
  showOnHomepage: boolean;
  restricted: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  attributeSetId: string | null;
  taxClassId: string | null;
  commissionRateBps: number | null;
  returnWindowDays: number | null;
  childCount: number;
  leaf: boolean;
  breadcrumb: string;
  children?: CategoryNode[];
}

/** Full live tree, nested + ordered — backs admin UI and the seller picker. */
export async function getCategoryTree(options?: {
  status?: 'ACTIVE' | 'INACTIVE';
  includeDeleted?: boolean;
}): Promise<CategoryNode[]> {
  const prisma = getPrisma();
  const rows = await prisma.category.findMany({
    where: {
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  type Row = (typeof rows)[number];
  const build: (parentId: string | null, trail: string[]) => CategoryNode[] = (parentId, trail) =>
    (byParent.get(parentId) ?? []).map((row) => toNode(row, trail));
  const toNode = (row: Row, trail: string[]): CategoryNode => {
    const children = build(row.id, [...trail, row.name]);
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageUrl,
      bannerUrl: row.bannerUrl,
      icon: row.icon,
      displayOrder: row.displayOrder,
      status: row.status,
      showInNav: row.showInNav,
      showOnHomepage: row.showOnHomepage,
      restricted: row.restricted,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      canonicalUrl: row.canonicalUrl,
      ogImageUrl: row.ogImageUrl,
      attributeSetId: row.attributeSetId,
      taxClassId: row.taxClassId,
      commissionRateBps: row.commissionRateBps,
      returnWindowDays: row.returnWindowDays,
      childCount: children.length,
      leaf: children.length === 0,
      breadcrumb: [...trail, row.name].join(' / '),
      children,
    };
  };
  // Orphan guard: a node whose parent id is missing (filtered out or
  // dangling) renders at root level with its subtree, rather than vanishing.
  const ids = new Set(rows.map((r) => r.id));
  const roots = build(null, []);
  for (const row of rows) {
    if (row.parentId !== null && !ids.has(row.parentId)) {
      roots.push(toNode({ ...row, parentId: row.parentId }, []));
    }
  }
  return roots;
}

export async function listCategories(query: {
  page: number;
  limit: number;
  search?: string | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  parentId?: string | undefined;
  rootOnly?: boolean;
  includeDeleted?: boolean;
}) {
  const prisma = getPrisma();
  const where: Prisma.CategoryWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.parentId ? { parentId: query.parentId } : {}),
    ...(query.rootOnly ? { parentId: null } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total, childCounts] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.category.count({ where }),
    prisma.category.groupBy({
      by: ['parentId'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(childCounts.map((g) => [g.parentId, g._count._all]));
  return {
    data: rows.map((r) => ({
      ...r,
      childCount: counts.get(r.id) ?? 0,
      leaf: (counts.get(r.id) ?? 0) === 0,
    })),
    total,
  };
}

export async function getCategory(id: string) {
  const prisma = getPrisma();
  const row = await prisma.category.findUnique({
    where: { id },
    include: { redirects: true, children: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!row || row.deletedAt) throw notFound('Category not found');
  return { ...row, childCount: row.children.length, leaf: row.children.length === 0 };
}

export async function createCategory(
  input: CreateCategoryInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const base = input.slug ? slugify(input.slug) : slugify(input.name);
  return prisma.$transaction(async (tx) => {
    await assertValidParent(tx, null, input.parentId ?? null);
    await assertAttributeSet(tx, input.attributeSetId);
    const slug = await uniqueSlug(tx, base);
    const created = await tx.category.create({
      data: {
        name: input.name.trim(),
        slug,
        parentId: input.parentId ?? null,
        description: clean(input.description) || null,
        imageUrl: clean(input.imageUrl) || null,
        bannerUrl: clean(input.bannerUrl) || null,
        icon: clean(input.icon) || null,
        displayOrder: input.displayOrder,
        showInNav: input.showInNav,
        showOnHomepage: input.showOnHomepage,
        restricted: input.restricted,
        metaTitle: clean(input.metaTitle) || null,
        metaDescription: clean(input.metaDescription) || null,
        canonicalUrl: clean(input.canonicalUrl) || null,
        ogImageUrl: clean(input.ogImageUrl) || null,
        attributeSetId: input.attributeSetId ?? null,
        taxClassId: input.taxClassId ?? null,
        commissionRateBps: input.commissionRateBps ?? null,
        returnWindowDays: input.returnWindowDays ?? null,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'category.created',
      resourceType: 'category',
      resourceId: created.id,
      after: { name: created.name, slug, parentId: created.parentId },
      meta,
    });
    return created;
  });
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.category.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Category not found');

  return prisma.$transaction(async (tx) => {
    if (input.parentId !== undefined) {
      await assertValidParent(tx, id, input.parentId);
    }
    if (input.attributeSetId !== undefined) {
      await assertAttributeSet(tx, input.attributeSetId ?? null);
    }
    let slug = row.slug;
    if (input.slug !== undefined || input.name !== undefined) {
      const base = input.slug ? slugify(input.slug) : slugify(input.name ?? row.name);
      if (base !== row.slug) {
        slug = await uniqueSlug(tx, base, id);
        // Retire the old slug as a permanent redirect — never reusable.
        await tx.categoryRedirect.upsert({
          where: { slug: row.slug },
          update: { categoryId: id },
          create: { slug: row.slug, categoryId: id },
        });
      }
    }
    const updated = await tx.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(slug !== row.slug ? { slug } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.description !== undefined
          ? { description: clean(input.description) || null }
          : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: clean(input.imageUrl) || null } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: clean(input.bannerUrl) || null } : {}),
        ...(input.icon !== undefined ? { icon: clean(input.icon) || null } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.showInNav !== undefined ? { showInNav: input.showInNav } : {}),
        ...(input.showOnHomepage !== undefined ? { showOnHomepage: input.showOnHomepage } : {}),
        ...(input.restricted !== undefined ? { restricted: input.restricted } : {}),
        ...(input.metaTitle !== undefined ? { metaTitle: clean(input.metaTitle) || null } : {}),
        ...(input.metaDescription !== undefined
          ? { metaDescription: clean(input.metaDescription) || null }
          : {}),
        ...(input.canonicalUrl !== undefined
          ? { canonicalUrl: clean(input.canonicalUrl) || null }
          : {}),
        ...(input.ogImageUrl !== undefined ? { ogImageUrl: clean(input.ogImageUrl) || null } : {}),
        ...(input.attributeSetId !== undefined
          ? { attributeSetId: input.attributeSetId }
          : {}),
        ...(input.taxClassId !== undefined ? { taxClassId: input.taxClassId } : {}),
        ...(input.commissionRateBps !== undefined
          ? { commissionRateBps: input.commissionRateBps }
          : {}),
        ...(input.returnWindowDays !== undefined
          ? { returnWindowDays: input.returnWindowDays }
          : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'category.updated',
      resourceType: 'category',
      resourceId: id,
      before: { name: row.name, slug: row.slug, parentId: row.parentId },
      after: { name: updated.name, slug: updated.slug, parentId: updated.parentId },
      meta,
    });
    return updated;
  });
}

export async function setCategoryStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.category.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Category not found');
  if (row.status === status) throw badRequest(`Category is already ${status}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'category.status_changed',
      resourceType: 'category',
      resourceId: id,
      before: { status: row.status },
      // Deactivation hides products storefront-side (Module 18 reads status).
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

export async function deleteCategory(
  id: string,
  reason: string,
  reassignTo: string | null | undefined,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.category.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Category not found');
  // Module 6 adds: block when products reference this node (offer reassign).
  const children = await prisma.category.findMany({
    where: { parentId: id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (children.length > 0 && !reassignTo) {
    throw conflict(
      `${children.length} sub-categor${children.length === 1 ? 'y lives' : 'ies live'} here — pass reassignTo to move them, or delete them first`,
    );
  }
  return prisma.$transaction(async (tx) => {
    if (children.length > 0 && reassignTo) {
      const target = await tx.category.findUnique({ where: { id: reassignTo } });
      if (!target || target.deletedAt) throw badRequest('Reassign target not found');
      if (reassignTo === id) throw badRequest('Cannot reassign into the category being deleted');
      await assertValidParent(tx, null, reassignTo);
      // The target must not sit under the deleted node (would orphan the move).
      const underDeleted = await tx.category.findFirst({
        where: { id: reassignTo, parentId: id },
      });
      if (underDeleted) throw badRequest('Reassign target lives under this category');
      await tx.category.updateMany({ where: { parentId: id }, data: { parentId: reassignTo } });
    }
    const deleted = await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'category.deleted',
      resourceType: 'category',
      resourceId: id,
      before: { name: row.name, slug: row.slug },
      after: { reason, reassignedChildren: children.length, reassignTo: reassignTo ?? null },
      meta,
    });
    return deleted;
  });
}

export interface ImportPreview {
  creates: number;
  updates: number;
  errors: Array<{ row: number; message: string }>;
  committed: boolean;
}

/**
 * Validated import. `validate` returns the preview without writing;
 * `commit` applies creates/updates transactionally per row and returns
 * the same shape with per-row errors (failed rows skip, rest apply).
 * Parents resolve by slug path ("fashion/men") or existing id.
 */
export async function importCategories(
  rows: Array<Record<string, unknown>>,
  mode: 'validate' | 'commit',
  actor: { adminId: string },
  meta: RequestMeta,
): Promise<ImportPreview> {
  const prisma = getPrisma();
  const errors: ImportPreview['errors'] = [];
  let creates = 0;
  let updates = 0;

  // Pre-pass: every row's slug + full path, so a child can reference a
  // parent created earlier in the SAME file ("electronics" then
  // parentPath "electronics"). Slug failures are recorded up front.
  const planned: Array<{ slug: string | null; fullPath: string | null }> = rows.map((r, i) => {
    try {
      const name = String(r?.['name'] ?? '').trim();
      if (name.length < 2) throw new Error('name is required (min 2 chars)');
      const slug = r?.['slug'] ? slugify(String(r['slug'])) : slugify(name);
      const parentPath = String(r?.['parentPath'] ?? '').trim().toLowerCase();
      return { slug, fullPath: parentPath ? `${parentPath}/${slug}` : slug };
    } catch (err) {
      errors.push({ row: i + 1, message: err instanceof Error ? err.message : 'Invalid row' });
      return { slug: null, fullPath: null };
    }
  });
  const rowFailed = (rowNum: number): boolean => errors.some((e) => e.row === rowNum);

  const resolveParent = async (
    client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
    row: Record<string, unknown>,
    rowNum: number,
  ): Promise<string | null> => {
    const db = client as Prisma.TransactionClient;
    if (row['parentId'] != null && row['parentId'] !== '') {
      const parent = await db.category.findUnique({
        where: { id: String(row['parentId']) },
      });
      if (!parent || parent.deletedAt) {
        errors.push({ row: rowNum, message: `parentId not found: ${row['parentId']}` });
        return null;
      }
      return parent.id;
    }
    const parentPath = String(row['parentPath'] ?? '').trim();
    if (!parentPath) return null;
    const segments = parentPath.split('/').map((s) => slugify(s));
    let parentId: string | null = null;
    let trail = '';
    for (const seg of segments) {
      trail = trail ? `${trail}/${seg}` : seg;
      const node: { id: string } | null = await db.category.findFirst({
        where: { slug: seg, parentId, deletedAt: null },
      });
      if (node) {
        parentId = node.id;
        continue;
      }
      // Within-file parent: an earlier row planning this exact path.
      const plannedIdx = planned.findIndex(
        (p, idx) => idx < rowNum - 1 && p.fullPath === trail,
      );
      if (plannedIdx === -1 || rowFailed(plannedIdx + 1)) {
        errors.push({ row: rowNum, message: `parent path not found at "${seg}" in "${parentPath}"` });
        return null;
      }
      // In commit mode earlier rows are already in the DB — re-read.
      const created: { id: string } | null = await db.category.findFirst({
        where: { slug: seg, parentId, deletedAt: null },
      });
      if (!created) {
        // Validate mode: the parent exists only on paper; accept and let
        // the child's own slug check decide creates/updates. Use a marker
        // the commit pass re-resolves — here we just record dependency.
        parentId = null;
        break;
      }
      parentId = created.id;
    }
    return parentId;
  };

  for (let i = 0; i < rows.length; i += 1) {
    const rowNum = i + 1;
    // Pre-pass already recorded this row's failure — don't double-report.
    if (rowFailed(rowNum)) continue;
    const row = rows[i] ?? {};
    try {
      const name = String(row['name'] ?? '').trim();
      if (name.length < 2) throw new Error('name is required (min 2 chars)');
      const slug = row['slug'] ? slugify(String(row['slug'])) : slugify(name);
      const parentId = await resolveParent(prisma, row, rowNum);
      if (rowFailed(rowNum)) continue;
      const existing = await prisma.category.findUnique({ where: { slug } });
      if (existing && !existing.deletedAt) updates += 1;
      else if (!existing) creates += 1;
      else {
        // Retired-slug collision: treat as create-after-rename in preview.
        creates += 1;
      }
      if (mode === 'commit' && !rowFailed(rowNum)) {
        await prisma.$transaction(async (tx) => {
          await assertValidParent(tx, existing && !existing.deletedAt ? existing.id : null, parentId);
          if (existing && !existing.deletedAt) {
            const patch: Prisma.CategoryUpdateInput = {
              name,
              ...(parentId ? { parent: { connect: { id: parentId } } } : { parent: { disconnect: true } }),
            };
            if (row['description']) patch.description = String(row['description']).slice(0, 2000);
            if (row['displayOrder'] !== undefined) patch.displayOrder = Number(row['displayOrder']) || 0;
            if (row['status'] === 'INACTIVE') patch.status = 'INACTIVE';
            if (row['showInNav'] !== undefined) patch.showInNav = Boolean(row['showInNav']);
            await tx.category.update({ where: { id: existing.id }, data: patch });
          } else {
            const finalSlug = existing ? await uniqueSlug(tx, slug) : slug;
            if (await slugTaken(tx, finalSlug)) throw new Error(`slug retired: ${slug}`);
            await tx.category.create({
              data: {
                name,
                slug: finalSlug,
                parentId,
                description: row['description'] ? String(row['description']).slice(0, 2000) : null,
                displayOrder: row['displayOrder'] !== undefined ? Number(row['displayOrder']) || 0 : 0,
                status: row['status'] === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              },
            });
          }
          await recordAudit(tx, {
            actorId: actor.adminId,
            action: 'category.imported',
            resourceType: 'category',
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

/** Flat, tree-ordered rows for CSV/JSON export. */
export async function exportCategories(): Promise<Array<Record<string, unknown>>> {
  const tree = await getCategoryTree();
  const out: Array<Record<string, unknown>> = [];
  const walk = (nodes: CategoryNode[], parentPath: string) => {
    for (const n of nodes) {
      const path = parentPath ? `${parentPath}/${n.slug}` : n.slug;
      out.push({
        name: n.name,
        slug: n.slug,
        parentPath,
        description: n.description ?? '',
        displayOrder: n.displayOrder,
        status: n.status,
        showInNav: n.showInNav,
        showOnHomepage: n.showOnHomepage,
        restricted: n.restricted,
        metaTitle: n.metaTitle ?? '',
        metaDescription: n.metaDescription ?? '',
      });
      if (n.children) walk(n.children, path);
    }
  };
  walk(tree, '');
  return out;
}

// ── Review queues (seller requests + restricted-access applications) ──

export async function listCategoryRequests(query: { page: number; limit: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const prisma = getPrisma();
  const where: Prisma.CategoryRequestWhereInput = { status: query.status };
  const [data, total] = await Promise.all([
    prisma.categoryRequest.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        proposedParent: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.categoryRequest.count({ where }),
  ]);
  return { data, total };
}

export async function reviewCategoryRequest(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  reviewNote: string | undefined,
  resolvedCategoryId: string | null | undefined,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.categoryRequest.findUnique({ where: { id } });
  if (!row) throw notFound('Request not found');
  if (row.status !== 'PENDING') throw badRequest('Request already decided');
  if (decision === 'APPROVED' && resolvedCategoryId) {
    const target = await prisma.category.findUnique({ where: { id: resolvedCategoryId } });
    if (!target || target.deletedAt) throw badRequest('Resolved category not found');
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.categoryRequest.update({
      where: { id },
      data: {
        status: decision,
        reviewNote: reviewNote?.trim() || null,
        resolvedCategoryId: resolvedCategoryId ?? null,
        reviewedById: actor.adminId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: decision === 'APPROVED' ? 'category.request_approved' : 'category.request_rejected',
      resourceType: 'category_request',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { decision, resolvedCategoryId: resolvedCategoryId ?? null },
      meta,
    });
    return updated;
  });
}

export async function listAccessGrants(query: { page: number; limit: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const prisma = getPrisma();
  const where: Prisma.CategoryAccessGrantWhereInput = { status: query.status };
  const [data, total] = await Promise.all([
    prisma.categoryAccessGrant.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.categoryAccessGrant.count({ where }),
  ]);
  return { data, total };
}

export async function reviewAccessGrant(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  reviewNote: string | undefined,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await prisma.categoryAccessGrant.findUnique({ where: { id } });
  if (!row) throw notFound('Application not found');
  if (row.status !== 'PENDING') throw badRequest('Application already decided');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.categoryAccessGrant.update({
      where: { id },
      data: {
        status: decision,
        reviewNote: reviewNote?.trim() || null,
        reviewedById: actor.adminId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: decision === 'APPROVED' ? 'category.access_approved' : 'category.access_rejected',
      resourceType: 'category_access',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { decision },
      meta,
    });
    return updated;
  });
}

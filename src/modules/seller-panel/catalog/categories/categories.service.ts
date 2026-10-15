import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getCategoryTree, type CategoryNode } from '../../../admin-panel/administration/categories/categories.service.js';
import { recordStoreAudit } from '../../activity/store-audit.service.js';
import type { ApplyAccessInput, CreateCategoryRequestInput } from './categories.schemas.js';

/**
 * Phase 1 · Module 2 — seller face of the category tree.
 *
 * Sellers see ACTIVE nodes only; restricted nodes carry their per-store
 * access state (`open` | `restricted` | `pending` | `granted`) so the
 * product form (Module 6) can gate selection. Requests and access
 * applications are store-scoped and audited like every other mutation.
 */

export type CategoryAccess = 'open' | 'restricted' | 'pending' | 'granted';
export type SellerCategoryNode = CategoryNode & { access: CategoryAccess };

export async function getSellerTree(storeId: string): Promise<SellerCategoryNode[]> {
  const [tree, grants] = await Promise.all([
    getCategoryTree({ status: 'ACTIVE' }),
    getPrisma().categoryAccessGrant.findMany({
      where: { storeId, status: { in: ['PENDING', 'APPROVED'] } },
      select: { categoryId: true, status: true },
    }),
  ]);
  const byCategory = new Map(grants.map((g) => [g.categoryId, g.status]));
  const mark = (nodes: CategoryNode[]): SellerCategoryNode[] =>
    nodes.map((n) => {
      let access: CategoryAccess = 'open';
      if (n.restricted) {
        const state = byCategory.get(n.id);
        access = state === 'APPROVED' ? 'granted' : state === 'PENDING' ? 'pending' : 'restricted';
      }
      return { ...n, access, children: n.children ? mark(n.children) : [] };
    });
  return mark(tree);
}

export async function createCategoryRequest(
  storeId: string,
  sellerId: string,
  actorEmail: string | null,
  input: CreateCategoryRequestInput,
  reqMeta: RequestMeta,
) {
  const prisma = getPrisma();
  if (input.proposedParentId) {
    const parent = await prisma.category.findUnique({ where: { id: input.proposedParentId } });
    if (!parent || parent.deletedAt || parent.status !== 'ACTIVE') {
      throw badRequest('Proposed parent category not found');
    }
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.categoryRequest.create({
      data: {
        storeId,
        sellerId,
        name: input.name.trim(),
        justification: input.justification.trim(),
        proposedParentId: input.proposedParentId ?? null,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'category.requested',
      resourceType: 'category_request',
      resourceId: row.id,
      metadata: { name: row.name, proposedParentId: row.proposedParentId },
      meta: reqMeta,
    });
    return row;
  });
  return created;
}

export async function listCategoryRequests(storeId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const prisma = getPrisma();
  return prisma.categoryRequest.findMany({
    where: { storeId, ...(status ? { status } : {}) },
    include: {
      proposedParent: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function applyForAccess(
  storeId: string,
  categoryId: string,
  sellerId: string,
  actorEmail: string | null,
  input: ApplyAccessInput,
  reqMeta: RequestMeta,
) {
  const prisma = getPrisma();
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.deletedAt || category.status !== 'ACTIVE') {
    throw notFound('Category not found');
  }
  if (!category.restricted) throw badRequest('This category is open — no application needed');

  const existing = await prisma.categoryAccessGrant.findFirst({
    where: { storeId, categoryId, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (existing) {
    throw conflict(
      existing.status === 'APPROVED'
        ? 'Access already granted for this category'
        : 'An application is already pending review',
    );
  }

  const assets = await prisma.storeMediaAsset.findMany({
    where: { storeId, id: { in: input.documentAssetIds } },
  });
  if (assets.length !== input.documentAssetIds.length) {
    throw badRequest('One or more documents do not belong to this store');
  }
  const nonDocs = assets.filter((a) => a.kind !== 'DOCUMENT');
  if (nonDocs.length > 0) throw badRequest('Authorisation proofs must be PDF documents');

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.categoryAccessGrant.create({
      data: {
        storeId,
        categoryId,
        documentAssetIds: input.documentAssetIds,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'category.access_requested',
      resourceType: 'category_access',
      resourceId: row.id,
      metadata: { categoryId, documents: input.documentAssetIds.length, note: input.note ?? null },
      meta: reqMeta,
    });
    return row;
  });
  return created;
}

export async function listAccessGrants(storeId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const prisma = getPrisma();
  return prisma.categoryAccessGrant.findMany({
    where: { storeId, ...(status ? { status } : {}) },
    include: { category: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

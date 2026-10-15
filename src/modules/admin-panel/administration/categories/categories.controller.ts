import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok, paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  createCategory,
  deleteCategory,
  exportCategories,
  getCategory,
  getCategoryTree,
  importCategories,
  listAccessGrants,
  listCategories,
  listCategoryRequests,
  reviewAccessGrant,
  reviewCategoryRequest,
  setCategoryStatus,
  updateCategory,
} from './categories.service.js';
import {
  deleteCategorySchema,
  importCategoriesSchema,
  listCategoriesQuerySchema,
  reviewAccessGrantSchema,
  reviewCategoryRequestSchema,
  reviewQueueQuerySchema,
  setCategoryStatusSchema,
  createCategorySchema,
  updateCategorySchema,
} from './categories.schemas.js';

const idParams = z.object({ id: z.string().min(1) });

export const listCategoriesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const query = listCategoriesQuerySchema.parse(req.query);
    const { data, total } = await listCategories(query);
    res.status(200).json(paginated(data, query.page, query.limit, total));
  }),
];

export const categoryTreeHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await getCategoryTree()));
  }),
];

export const getCategoryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = idParams.parse(req.params);
    res.status(200).json(ok(await getCategory(id)));
  }),
];

export const createCategoryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createCategorySchema.parse(req.body);
    const created = await createCategory(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateCategoryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const input = updateCategorySchema.parse(req.body);
    const updated = await updateCategory(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

export const setCategoryStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { status, reason } = setCategoryStatusSchema.parse(req.body);
    const updated = await setCategoryStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteCategoryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { reason, reassignTo } = deleteCategorySchema.parse(req.body);
    const deleted = await deleteCategory(
      id,
      reason,
      reassignTo,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok({ id: deleted.id, deletedAt: deleted.deletedAt }));
  }),
];

export const importCategoriesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { mode, rows } = importCategoriesSchema.parse(req.body);
    const preview = await importCategories(
      rows as Array<Record<string, unknown>>,
      mode,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(preview));
  }),
];

export const exportCategoriesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await exportCategories()));
  }),
];

export const listCategoryRequestsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const query = reviewQueueQuerySchema.parse(req.query);
    const { data, total } = await listCategoryRequests(query);
    res.status(200).json(paginated(data, query.page, query.limit, total));
  }),
];

export const reviewCategoryRequestHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { decision, reviewNote, resolvedCategoryId } = reviewCategoryRequestSchema.parse(req.body);
    const updated = await reviewCategoryRequest(
      id,
      decision,
      reviewNote,
      resolvedCategoryId,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const listAccessGrantsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const query = reviewQueueQuerySchema.parse(req.query);
    const { data, total } = await listAccessGrants(query);
    res.status(200).json(paginated(data, query.page, query.limit, total));
  }),
];

export const reviewAccessGrantHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.CATEGORY_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { decision, reviewNote } = reviewAccessGrantSchema.parse(req.body);
    const updated = await reviewAccessGrant(
      id,
      decision,
      reviewNote,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

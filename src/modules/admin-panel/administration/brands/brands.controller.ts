import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  createBrand,
  exportBrands,
  getBrand,
  importBrands,
  listBrandAuthorisations,
  listBrandRequests,
  listBrands,
  mergeBrand,
  reviewBrandAuthorisation,
  reviewBrandRequest,
  setBrandStatus,
  updateBrand,
} from './brands.service.js';
import {
  createBrandSchema,
  importBrandsSchema,
  listBrandsQuerySchema,
  mergeBrandSchema,
  reviewBrandAuthorisationSchema,
  reviewBrandRequestSchema,
  reviewQueueQuerySchema,
  setBrandStatusSchema,
  updateBrandSchema,
} from './brands.schemas.js';

const idParams = z.object({ id: z.string().min(1) });

export const listBrandsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listBrandsQuerySchema.parse(req.query);
    const { data, pagination } = await listBrands({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const getBrandHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = idParams.parse(req.params);
    res.status(200).json(ok(await getBrand(id)));
  }),
];

export const createBrandHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createBrandSchema.parse(req.body);
    const created = await createBrand(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateBrandHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const input = updateBrandSchema.parse(req.body);
    const updated = await updateBrand(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

export const setBrandStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { status, reason } = setBrandStatusSchema.parse(req.body);
    const updated = await setBrandStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const mergeBrandHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { targetId, reason } = mergeBrandSchema.parse(req.body);
    const merged = await mergeBrand(
      id,
      targetId,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res
      .status(200)
      .json(ok({ id: merged.id, mergedIntoId: merged.mergedIntoId, deletedAt: merged.deletedAt }));
  }),
];

export const importBrandsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { mode, rows } = importBrandsSchema.parse(req.body);
    const preview = await importBrands(
      rows as Array<Record<string, unknown>>,
      mode,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(preview));
  }),
];

export const exportBrandsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await exportBrands()));
  }),
];

export const listBrandRequestsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, status } = reviewQueueQuerySchema.parse(req.query);
    const { data, total } = await listBrandRequests({ page, limit, status });
    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
];

export const reviewBrandRequestHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { decision, reviewNote, resolvedBrandId } = reviewBrandRequestSchema.parse(req.body);
    const updated = await reviewBrandRequest(
      id,
      decision,
      reviewNote,
      resolvedBrandId,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const listBrandAuthorisationsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, status } = reviewQueueQuerySchema.parse(req.query);
    const { data, total } = await listBrandAuthorisations({ page, limit, status });
    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
];

export const reviewBrandAuthorisationHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.BRAND_MANAGE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { decision, reviewNote, expiresAt } = reviewBrandAuthorisationSchema.parse(req.body);
    const updated = await reviewBrandAuthorisation(
      id,
      decision,
      reviewNote,
      expiresAt,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

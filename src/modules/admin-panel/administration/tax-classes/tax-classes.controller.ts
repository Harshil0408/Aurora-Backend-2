import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  createTaxClass,
  createTaxRate,
  deleteTaxClass,
  deleteTaxRate,
  getTaxClass,
  listTaxClasses,
  quoteTaxPreview,
  setTaxClassStatus,
  updateTaxClass,
  updateTaxRate,
} from './tax-classes.service.js';
import {
  createTaxClassSchema,
  createTaxRateSchema,
  listTaxClassesQuerySchema,
  quoteInputSchema,
  setTaxClassStatusSchema,
  taxClassIdParamSchema,
  taxRateParamsSchema,
  updateTaxClassSchema,
  updateTaxRateSchema,
} from './tax-classes.schemas.js';

/**
 * Handlers for the tax-class screen (Module 5). Rate rows nest under the
 * class; the quote preview shares this router (static path) so the admin
 * tool mirrors exactly what checkout will apply.
 */
const perm = () => PERMISSIONS.TAX_MANAGE;

export const listTaxClassesHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listTaxClassesQuerySchema.parse(req.query);
    const { data, pagination } = await listTaxClasses({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const getTaxClassHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = taxClassIdParamSchema.parse(req.params);
    res.status(200).json(ok(await getTaxClass(id)));
  }),
];

export const createTaxClassHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createTaxClassSchema.parse(req.body);
    const created = await createTaxClass(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateTaxClassHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = taxClassIdParamSchema.parse(req.params);
    const input = updateTaxClassSchema.parse(req.body);
    const updated = await updateTaxClass(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

export const setTaxClassStatusHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = taxClassIdParamSchema.parse(req.params);
    const { status, reason } = setTaxClassStatusSchema.parse(req.body);
    const updated = await setTaxClassStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteTaxClassHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = taxClassIdParamSchema.parse(req.params);
    const deleted = await deleteTaxClass(id, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

export const createTaxRateHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = taxClassIdParamSchema.parse(req.params);
    const input = createTaxRateSchema.parse(req.body);
    const created = await createTaxRate(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateTaxRateHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, rateId } = taxRateParamsSchema.parse(req.params);
    const input = updateTaxRateSchema.parse(req.body);
    const updated = await updateTaxRate(
      id,
      rateId,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteTaxRateHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, rateId } = taxRateParamsSchema.parse(req.params);
    const deleted = await deleteTaxRate(id, rateId, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

export const quotePreviewHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const input = quoteInputSchema.parse(req.body);
    const quote = await quoteTaxPreview(input);
    res.status(200).json(ok(quote));
  }),
];

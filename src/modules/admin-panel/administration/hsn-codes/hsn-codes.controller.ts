import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import { createHsnCode, deleteHsnCode, listHsnCodes, updateHsnCode } from './hsn-codes.service.js';
import {
  createHsnCodeSchema,
  hsnIdParamSchema,
  listHsnQuerySchema,
  updateHsnCodeSchema,
} from './hsn-codes.schemas.js';

/** Handlers for the HSN/SAC master screen (Module 5). */
const perm = () => PERMISSIONS.TAX_MANAGE;

export const listHsnCodesHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listHsnQuerySchema.parse(req.query);
    const { data, pagination } = await listHsnCodes({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const createHsnCodeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createHsnCodeSchema.parse(req.body);
    const created = await createHsnCode(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateHsnCodeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = hsnIdParamSchema.parse(req.params);
    const input = updateHsnCodeSchema.parse(req.body);
    const updated = await updateHsnCode(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

export const deleteHsnCodeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = hsnIdParamSchema.parse(req.params);
    const deleted = await deleteHsnCode(id, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

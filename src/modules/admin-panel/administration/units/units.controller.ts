import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import { createUnit, deleteUnit, listUnits, updateUnit } from './units.service.js';
import {
  createUnitSchema,
  listUnitsQuerySchema,
  unitIdParamSchema,
  updateUnitSchema,
} from './units.schemas.js';

/** Handlers for the units-of-measure screen (Module 5). */
const perm = () => PERMISSIONS.TAX_MANAGE;

export const listUnitsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listUnitsQuerySchema.parse(req.query);
    const { data, pagination } = await listUnits({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const createUnitHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createUnitSchema.parse(req.body);
    const created = await createUnit(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateUnitHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = unitIdParamSchema.parse(req.params);
    const input = updateUnitSchema.parse(req.body);
    const updated = await updateUnit(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

export const deleteUnitHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = unitIdParamSchema.parse(req.params);
    const deleted = await deleteUnit(id, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

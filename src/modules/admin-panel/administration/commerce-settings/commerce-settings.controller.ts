import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import { getSettings, updateSettings } from './commerce-settings.service.js';
import { updateSettingsSchema } from './commerce-settings.schemas.js';

/** Handlers for the commerce-settings singleton (Module 5). */
const perm = () => PERMISSIONS.TAX_MANAGE;

export const getSettingsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await getSettings()));
  }),
];

export const updateSettingsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = updateSettingsSchema.parse(req.body);
    const updated = await updateSettings(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(updated));
  }),
];

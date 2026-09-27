import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { isSuperAdmin } from '../../../rbac/rbac.service.js';
import { getAuth, requireAuth } from '../../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../../auth/middleware/requirePerm.js';
import {
  createRole,
  getRoleByKey,
  listPermissionCatalog,
  listRoles,
  setRolePermissions,
  updateRole,
} from './roles-permissions.service.js';
import {
  createRoleSchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
} from './roles-permissions.schemas.js';

const roleKeyParams = z.object({ key: z.string().min(1) });

export const listRolesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_READ),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await listRoles()));
  }),
];

export const createRoleHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_CREATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const body = createRoleSchema.parse(req.body);
    const role = await createRole({ ...body, actorId: auth.adminId, meta: getRequestMeta(req) });
    res.status(201).json(ok(role));
  }),
];

export const getRoleHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { key } = roleKeyParams.parse(req.params);
    res.status(200).json(ok(await getRoleByKey(key)));
  }),
];

export const updateRoleHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = roleKeyParams.parse(req.params);
    const body = updateRoleSchema.parse(req.body);
    const role = await updateRole({
      roleKey: key,
      ...body,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(role));
  }),
];

export const listPermissionsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_READ),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await listPermissionCatalog()));
  }),
];

export const setRolePermsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = roleKeyParams.parse(req.params);
    const { permissionKeys } = updateRolePermissionsSchema.parse(req.body);
    await setRolePermissions({
      roleKey: key,
      permissionKeys,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok({ updated: true }));
  }),
];

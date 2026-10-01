import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getEffectivePermissions, isSuperAdmin } from '../../../rbac/rbac.service.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  cloneRole,
  createPermission,
  createRole,
  deletePermission,
  deleteRole,
  getRoleByKey,
  listPermissionCatalog,
  listPermissionsFlat,
  listRoles,
  setPermissionStatus,
  setRolePermissions,
  setRoleStatus,
  updatePermission,
  updateRole,
} from './roles-permissions.service.js';
import {
  cloneRoleSchema,
  createPermissionSchema,
  createRoleSchema,
  setPermissionStatusSchema,
  setRoleStatusSchema,
  updatePermissionSchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
} from './roles-permissions.schemas.js';

const roleKeyParams = z.object({ key: z.string().min(1) });
const permissionKeyParams = z.object({ key: z.string().min(1) });
const statusQuery = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

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

export const cloneRoleHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_CREATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = roleKeyParams.parse(req.params);
    const body = cloneRoleSchema.parse(req.body);
    const role = await cloneRole({
      sourceKey: key,
      ...body,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(201).json(ok(role));
  }),
];

export const setRoleStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = roleKeyParams.parse(req.params);
    const body = setRoleStatusSchema.parse(req.body);
    const role = await setRoleStatus({
      roleKey: key,
      status: body.status,
      reason: body.reason,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(role));
  }),
];

export const deleteRoleHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = roleKeyParams.parse(req.params);
    await deleteRole({
      roleKey: key,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok({ deleted: true }));
  }),
];

/** Flat permission list for admin assignment screens (filter ?status=). */
export const listPermissionsFlatHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { status } = statusQuery.parse(req.query);
    res.status(200).json(ok(await listPermissionsFlat(status)));
  }),
];

export const createPermissionHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const body = createPermissionSchema.parse(req.body);
    const perm = await createPermission({
      ...body,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(201).json(ok(perm));
  }),
];

export const updatePermissionHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = permissionKeyParams.parse(req.params);
    const body = updatePermissionSchema.parse(req.body);
    const perm = await updatePermission({
      key,
      ...body,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(perm));
  }),
];

export const setPermissionStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = permissionKeyParams.parse(req.params);
    const body = setPermissionStatusSchema.parse(req.body);
    const perm = await setPermissionStatus({
      key,
      status: body.status,
      reason: body.reason,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(perm));
  }),
];

export const deletePermissionHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { key } = permissionKeyParams.parse(req.params);
    await deletePermission({
      key,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok({ deleted: true }));
  }),
];

export const getMyPermissionsHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const perms = await getEffectivePermissions(auth.adminId);
    res.status(200).json(ok({ permissions: [...perms].sort() }));
  }),
];

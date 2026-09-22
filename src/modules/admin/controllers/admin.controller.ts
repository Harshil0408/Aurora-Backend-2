import type { Request, Response } from 'express';
import { ok, paginated } from '../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { isSuperAdmin } from '../../rbac/rbac.service.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  createAdmin,
  createRole,
  listAdmins,
  listRoles,
  queryAuditLog,
  setAdminRoles,
  setAdminStatus,
  setRolePermissions,
} from '../services/admin.service.js';
import {
  assignRolesSchema,
  adminStatusSchema,
  createAdminSchema,
  createRoleSchema,
  updateRolePermissionsSchema,
} from '../../auth/validation/auth.schemas.js';
import { paginationSchema } from '../../auth/validation/auth.schemas.js';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1) });
const roleKeyParams = z.object({ key: z.string().min(1) });
const auditQuerySchema = paginationSchema.extend({ action: z.string().min(1).max(128).optional() });

export const listAdminsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit } = paginationSchema.parse(req.query);
    const { data, total } = await listAdmins(page, limit);
    res.status(200).json(paginated(data, page, limit, total));
  }),
];

export const createAdminHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_CREATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const body = createAdminSchema.parse(req.body);
    const view = await createAdmin({
      ...body,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(201).json(ok(view));
  }),
];

export const setStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_SUSPEND),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { status } = adminStatusSchema.parse(req.body);
    await setAdminStatus({
      targetId: id,
      status,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok({ updated: true }));
  }),
];

export const setRolesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_ASSIGN),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { roleKeys } = assignRolesSchema.parse(req.body);
    await setAdminRoles({
      targetId: id,
      roleKeys,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok({ updated: true }));
  }),
];

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
    await createRole({ ...body, actorId: auth.adminId, meta: getRequestMeta(req) });
    res.status(201).json(ok({ created: true }));
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

export const queryAuditHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, action } = auditQuerySchema.parse(req.query);
    const { data, total } = await queryAuditLog(page, limit, action);
    res.status(200).json(paginated(data, page, limit, total));
  }),
];

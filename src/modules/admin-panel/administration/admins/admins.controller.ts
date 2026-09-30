import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok, paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { badRequest } from '../../../../shared/errors/AppError.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { isSuperAdmin } from '../../../rbac/rbac.service.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  checkEmailAvailability,
  createAdmin,
  generateTempPassword,
  getAdminDetail,
  getAdminsSummary,
  listAdmins,
  normalizeStatus,
  revokeAdminSessions,
  setAdminRoles,
  setAdminStatus,
} from './admins.service.js';
import {
  adminStatusSchema,
  assignRolesSchema,
  checkEmailQuerySchema,
  createAdminSchema,
  listAdminsQuerySchema,
} from './admins.schemas.js';

const idParams = z.object({ id: z.string().min(1) });

export const listAdminsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { page, limit, status, role, search, sort } = listAdminsQuerySchema.parse(req.query);
    const { data, total, counts, twoFactorEnabled } = await listAdmins({
      page,
      limit,
      status,
      role,
      search,
      sort,
      actorId: auth.adminId,
    });
    res.status(200).json(paginated(data, page, limit, total, { counts, twoFactorEnabled }));
  }),
];

export const getAdminsSummaryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_READ),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await getAdminsSummary()));
  }),
];

export const getAdminDetailHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    res.status(200).json(ok(await getAdminDetail(id, auth.adminId)));
  }),
];

export const checkEmailHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email } = checkEmailQuerySchema.parse(req.query);
    res.status(200).json(ok(await checkEmailAvailability(email)));
  }),
];

export const generatePasswordHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_CREATE),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(generateTempPassword()));
  }),
];

export const createAdminHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ADMIN_CREATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const body = createAdminSchema.parse(req.body);
    const password = body.tempPassword ?? body.password;
    if (!password) {
      throw badRequest('tempPassword is required', {
        code: 'REQUIRED',
        field: 'tempPassword',
      });
    }
    const view = await createAdmin({
      email: body.email,
      name: body.name,
      password,
      roleKeys: body.roleKeys,
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
    const { status, reason } = adminStatusSchema.parse(req.body);
    const result = await setAdminStatus({
      targetId: id,
      status: normalizeStatus(status),
      reason,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(result));
  }),
];

export const setRolesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ROLE_ASSIGN),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { roleKeys } = assignRolesSchema.parse(req.body);
    const result = await setAdminRoles({
      targetId: id,
      roleKeys,
      actorId: auth.adminId,
      actorIsSuperAdmin: await isSuperAdmin(auth.adminId),
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(result));
  }),
];

export const revokeAdminSessionsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.SESSION_REVOKE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const result = await revokeAdminSessions({
      targetId: id,
      actorId: auth.adminId,
      meta: getRequestMeta(req),
    });
    res.status(200).json(ok(result));
  }),
];

import type { Request, Response, NextFunction } from 'express';
import { getRequestMeta } from '../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from './store-permissions.js';
import {
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  setRolePermissions,
  updateRole,
} from './roles.service.js';
import {
  acceptInvitation,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from './members.service.js';
import {
  createRoleSchema,
  inviteMemberSchema,
  setPermissionsSchema,
  updateMemberRoleSchema,
  updateRoleSchema,
} from './team.schemas.js';
import { getPrisma } from '../../../config/db.js';
import { z } from 'zod';

async function actorEmail(sellerId: string): Promise<string | null> {
  const seller = await getPrisma().sellerUser.findUnique({ where: { id: sellerId } });
  return seller?.email ?? null;
}

export const listRolesHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_READ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await listRoles(getStoreAuth(req).storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const createRoleHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_CREATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const input = createRoleSchema.parse(req.body);
      const role = await createRole(
        storeAuth.storeId,
        auth.sellerId,
        await actorEmail(auth.sellerId),
        input,
        getRequestMeta(req),
      );
      res.status(201).json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  },
];

export const updateRoleHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_UPDATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const input = updateRoleSchema.parse(req.body);
      const roleKey = z.string().min(1).parse(req.params['roleKey']);
      res.json({
        success: true,
        data: await updateRole(
          storeAuth.storeId,
          roleKey,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          input,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const setRolePermissionsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_UPDATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const { permissionKeys } = setPermissionsSchema.parse(req.body);
      const roleKey = z.string().min(1).parse(req.params['roleKey']);
      res.json({
        success: true,
        data: await setRolePermissions(
          storeAuth.storeId,
          roleKey,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          permissionKeys,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const deleteRoleHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_DELETE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const roleKey = z.string().min(1).parse(req.params['roleKey']);
      res.json({
        success: true,
        data: await deleteRole(
          storeAuth.storeId,
          roleKey,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const listPermissionsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ROLE_READ),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await listPermissions() });
    } catch (err) {
      next(err);
    }
  },
];

export const listMembersHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_INVITE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await listMembers(getStoreAuth(req).storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const inviteMemberHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_INVITE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const input = inviteMemberSchema.parse(req.body);
      res.status(201).json({
        success: true,
        data: await inviteMember(
          storeAuth.storeId,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          input.email,
          input.roleKey,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const listInvitationsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_INVITE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await listInvitations(getStoreAuth(req).storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const revokeInvitationHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_INVITE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const invitationId = z.string().min(1).parse(req.params['invitationId']);
      res.json({
        success: true,
        data: await revokeInvitation(
          storeAuth.storeId,
          invitationId,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const updateMemberRoleHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_UPDATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const { roleKey } = updateMemberRoleSchema.parse(req.body);
      const userId = z.string().min(1).parse(req.params['userId']);
      res.json({
        success: true,
        data: await updateMemberRole(
          storeAuth.storeId,
          userId,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          roleKey,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const removeMemberHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STAFF_REMOVE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const userId = z.string().min(1).parse(req.params['userId']);
      res.json({
        success: true,
        data: await removeMember(
          storeAuth.storeId,
          userId,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const acceptInvitationHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
      res.json({
        success: true,
        data: await acceptInvitation(auth.sellerId, token, getRequestMeta(req)),
      });
    } catch (err) {
      next(err);
    }
  },
];

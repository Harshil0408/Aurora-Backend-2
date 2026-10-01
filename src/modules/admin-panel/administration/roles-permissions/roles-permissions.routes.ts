import { Router } from 'express';
import {
  cloneRoleHandler,
  createPermissionHandler,
  createRoleHandler,
  deletePermissionHandler,
  deleteRoleHandler,
  getMyPermissionsHandler,
  getRoleHandler,
  listPermissionsFlatHandler,
  listPermissionsHandler,
  listRolesHandler,
  setPermissionStatusHandler,
  setRolePermsHandler,
  setRoleStatusHandler,
  updatePermissionHandler,
  updateRoleHandler,
} from './roles-permissions.controller.js';

/**
 * Roles & Permissions screen routes (admin panel → Administration group).
 * Mounted under /api/v1/admin via administrationRouter. Existing paths are
 * frozen — new endpoints only ADD paths (clone/status/permissions CRUD/me).
 */
export const rolesPermissionsRouter: Router = Router();

// Self permissions for the frontend can() helper (auth-only).
rolesPermissionsRouter.get('/permissions/me', ...getMyPermissionsHandler);
// Grouped matrix (existing) + flat list (new, ?status= filter).
rolesPermissionsRouter.get('/permissions', ...listPermissionsHandler);
rolesPermissionsRouter.get('/permissions/list', ...listPermissionsFlatHandler);
rolesPermissionsRouter.post('/permissions', ...createPermissionHandler);
rolesPermissionsRouter.patch('/permissions/:key', ...updatePermissionHandler);
rolesPermissionsRouter.patch('/permissions/:key/status', ...setPermissionStatusHandler);
rolesPermissionsRouter.delete('/permissions/:key', ...deletePermissionHandler);

rolesPermissionsRouter.get('/roles', ...listRolesHandler);
rolesPermissionsRouter.post('/roles', ...createRoleHandler);
rolesPermissionsRouter.get('/roles/:key', ...getRoleHandler);
rolesPermissionsRouter.patch('/roles/:key', ...updateRoleHandler);
rolesPermissionsRouter.put('/roles/:key/permissions', ...setRolePermsHandler);
rolesPermissionsRouter.post('/roles/:key/clone', ...cloneRoleHandler);
rolesPermissionsRouter.patch('/roles/:key/status', ...setRoleStatusHandler);
rolesPermissionsRouter.delete('/roles/:key', ...deleteRoleHandler);

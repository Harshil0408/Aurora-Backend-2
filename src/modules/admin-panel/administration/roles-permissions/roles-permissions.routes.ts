import { Router } from 'express';
import {
  addRolePermsHandler,
  cloneRoleHandler,
  createRoleHandler,
  deleteRoleHandler,
  getMyPermissionsHandler,
  getRoleHandler,
  listPermissionsFlatHandler,
  listPermissionsHandler,
  listRolesHandler,
  removeRolePermsHandler,
  setRolePermsHandler,
  setRoleStatusHandler,
  updateRoleHandler,
} from './roles-permissions.controller.js';

/**
 * Roles & Permissions screen routes (admin panel → Administration group).
 * Mounted under /api/v1/admin via administrationRouter.
 *
 * Frontend surface is intentionally narrow: list roles + catalog, add roles,
 * and check/uncheck permissions on roles. Permission keys are code-defined
 * and seeded — their create/update/status/delete handlers exist in the
 * controller/service but are NOT routed.
 */
export const rolesPermissionsRouter: Router = Router();

// Self permissions for the frontend can() helper (auth-only).
rolesPermissionsRouter.get('/permissions/me', ...getMyPermissionsHandler);
// Grouped matrix + flat list (?status= filter) — read-only catalog for the UI.
rolesPermissionsRouter.get('/permissions', ...listPermissionsHandler);
rolesPermissionsRouter.get('/permissions/list', ...listPermissionsFlatHandler);

rolesPermissionsRouter.get('/roles', ...listRolesHandler);
rolesPermissionsRouter.post('/roles', ...createRoleHandler);
rolesPermissionsRouter.get('/roles/:key', ...getRoleHandler);
rolesPermissionsRouter.patch('/roles/:key', ...updateRoleHandler);
rolesPermissionsRouter.put('/roles/:key/permissions', ...setRolePermsHandler);
rolesPermissionsRouter.post('/roles/:key/permissions', ...addRolePermsHandler);
rolesPermissionsRouter.delete('/roles/:key/permissions', ...removeRolePermsHandler);
rolesPermissionsRouter.post('/roles/:key/clone', ...cloneRoleHandler);
rolesPermissionsRouter.patch('/roles/:key/status', ...setRoleStatusHandler);
rolesPermissionsRouter.delete('/roles/:key', ...deleteRoleHandler);

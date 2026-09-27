import { Router } from 'express';
import {
  createRoleHandler,
  getRoleHandler,
  listPermissionsHandler,
  listRolesHandler,
  setRolePermsHandler,
  updateRoleHandler,
} from './roles-permissions.controller.js';

export const rolesPermissionsRouter: Router = Router();

rolesPermissionsRouter.get('/permissions', ...listPermissionsHandler);
rolesPermissionsRouter.get('/roles', ...listRolesHandler);
rolesPermissionsRouter.post('/roles', ...createRoleHandler);
rolesPermissionsRouter.get('/roles/:key', ...getRoleHandler);
rolesPermissionsRouter.patch('/roles/:key', ...updateRoleHandler);
rolesPermissionsRouter.put('/roles/:key/permissions', ...setRolePermsHandler);

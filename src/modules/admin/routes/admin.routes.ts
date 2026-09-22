import { Router } from 'express';
import {
  createAdminHandler,
  createRoleHandler,
  listAdminsHandler,
  listRolesHandler,
  queryAuditHandler,
  setRolesHandler,
  setRolePermsHandler,
  setStatusHandler,
} from '../controllers/admin.controller.js';

export const adminRouter: Router = Router();

adminRouter.get('/admins', ...listAdminsHandler);
adminRouter.post('/admins', ...createAdminHandler);
adminRouter.patch('/admins/:id/status', ...setStatusHandler);
adminRouter.put('/admins/:id/roles', ...setRolesHandler);

adminRouter.get('/roles', ...listRolesHandler);
adminRouter.post('/roles', ...createRoleHandler);
adminRouter.put('/roles/:key/permissions', ...setRolePermsHandler);

adminRouter.get('/audit-log', ...queryAuditHandler);

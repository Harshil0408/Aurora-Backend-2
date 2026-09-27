import { Router } from 'express';
import {
  createAdminHandler,
  listAdminsHandler,
  setRolesHandler,
  setStatusHandler,
} from './admins.controller.js';

/** Admins screen routes. Mounted under /api/v1/admin via administrationRouter. */
export const adminsRouter: Router = Router();

adminsRouter.get('/admins', ...listAdminsHandler);
adminsRouter.post('/admins', ...createAdminHandler);
adminsRouter.patch('/admins/:id/status', ...setStatusHandler);
adminsRouter.put('/admins/:id/roles', ...setRolesHandler);

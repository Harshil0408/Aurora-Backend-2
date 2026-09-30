import { Router } from 'express';
import {
  checkEmailHandler,
  createAdminHandler,
  generatePasswordHandler,
  getAdminDetailHandler,
  getAdminsSummaryHandler,
  listAdminsHandler,
  revokeAdminSessionsHandler,
  setRolesHandler,
  setStatusHandler,
} from './admins.controller.js';

/**
 * Admins screen routes. Mounted under /api/v1/admin via administrationRouter.
 * Static GETs (summary, check-email) are registered BEFORE /:id so the
 * param route never swallows them.
 */
export const adminsRouter: Router = Router();

adminsRouter.get('/admins/summary', ...getAdminsSummaryHandler);
adminsRouter.get('/admins/check-email', ...checkEmailHandler);
adminsRouter.post('/admins/password/generate', ...generatePasswordHandler);
adminsRouter.get('/admins', ...listAdminsHandler);
adminsRouter.get('/admins/:id', ...getAdminDetailHandler);
adminsRouter.post('/admins', ...createAdminHandler);
adminsRouter.patch('/admins/:id/status', ...setStatusHandler);
adminsRouter.put('/admins/:id/roles', ...setRolesHandler);
adminsRouter.post('/admins/:id/revoke-sessions', ...revokeAdminSessionsHandler);

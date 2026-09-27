import { Router } from 'express';
import { queryAuditHandler } from './activity-log.controller.js';

/** Activity Log screen routes. Mounted under /api/v1/admin via administrationRouter. */
export const activityLogRouter: Router = Router();

activityLogRouter.get('/audit-log', ...queryAuditHandler);

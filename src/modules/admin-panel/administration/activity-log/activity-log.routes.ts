import { Router } from 'express';
import {
  getActivityEntryHandler,
  listActionOptionsHandler,
  listActivityHandler,
  queryAuditHandler,
} from './activity-log.controller.js';

/** Activity Log screen routes. Mounted under /api/v1/admin via administrationRouter. */
export const activityLogRouter: Router = Router();

activityLogRouter.get('/audit-log', ...queryAuditHandler);
// Feed API (snapshot entries + derived diffs). '/actions' must precede '/:id'.
activityLogRouter.get('/activity', ...listActivityHandler);
activityLogRouter.get('/activity/actions', ...listActionOptionsHandler);
activityLogRouter.get('/activity/:id', ...getActivityEntryHandler);

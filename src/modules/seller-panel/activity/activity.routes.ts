import { Router } from 'express';
import { listStoreAuditHandler } from './activity.controller.js';

export const activityAreaRouter: Router = Router();

activityAreaRouter.get('/:storeId/audit', ...listStoreAuditHandler);

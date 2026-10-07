import { Router } from 'express';
import { getSubscriptionHandler, listPlansHandler } from './billing.controller.js';

export const billingAreaRouter: Router = Router();

billingAreaRouter.get('/plans', ...listPlansHandler);
billingAreaRouter.get('/:storeId/subscription', ...getSubscriptionHandler);

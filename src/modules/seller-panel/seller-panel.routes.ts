import { Router } from 'express';
import { sellerAuthRouter } from './auth/seller-auth.routes.js';
import { storesAreaRouter } from './stores/stores.routes.js';
import { teamAreaRouter } from './team/team.routes.js';
import { billingAreaRouter } from './billing/billing.routes.js';
import { activityAreaRouter } from './activity/activity.routes.js';

/**
 * Seller panel — owns the entire `/api/v1/seller/*` namespace.
 *
 * Identity (`/auth/*`: register, login, me, sessions) is isolated from the
 * admin panel. Every store-scoped route carries `:storeId` and passes
 * through `requireStoreAccess`, which re-validates membership server-side —
 * the frontend's active-store selection is never trusted.
 */
export const sellerPanelRouter: Router = Router();

sellerPanelRouter.use('/auth', sellerAuthRouter);
sellerPanelRouter.use('/stores', storesAreaRouter);
sellerPanelRouter.use('/team', teamAreaRouter);
sellerPanelRouter.use('/billing', billingAreaRouter);
sellerPanelRouter.use('/activity', activityAreaRouter);

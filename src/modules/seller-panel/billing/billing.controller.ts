import type { Request, Response, NextFunction } from 'express';
import { getSellerAuth, requireSellerAuth } from '../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../team/store-permissions.js';
import { getCurrentSubscription, listPlans } from './billing.service.js';

export const listPlansHandler = [
  requireSellerAuth,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Authenticated sellers can browse plans before creating a store.
      void getSellerAuth(_req);
      res.json({ success: true, data: await listPlans() });
    } catch (err) {
      next(err);
    }
  },
];

export const getSubscriptionHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BILLING_READ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        // Payment provider (Razorpay/Stripe) + webhooks attach in the next
        // increment; this endpoint already exposes trial/entitlement state.
        data: await getCurrentSubscription(getStoreAuth(req).storeId),
      });
    } catch (err) {
      next(err);
    }
  },
];

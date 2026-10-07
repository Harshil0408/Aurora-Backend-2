import type { Request, Response, NextFunction } from 'express';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../../team/store-permissions.js';
import {
  completeOnboarding,
  createStore,
  getStore,
  listMyStores,
  switchStore,
  updateStore,
} from './stores.service.js';
import { createStoreSchema, switchStoreSchema, updateStoreSchema } from './stores.schemas.js';
import { getPrisma } from '../../../../config/db.js';

export const createStoreHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const input = createStoreSchema.parse(req.body);
      const store = await createStore(auth.sellerId, input, getRequestMeta(req));
      res.status(201).json({ success: true, data: store });
    } catch (err) {
      next(err);
    }
  },
];

export const listMyStoresHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      res.json({ success: true, data: await listMyStores(auth.sellerId) });
    } catch (err) {
      next(err);
    }
  },
];

export const switchStoreHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const { storeId } = switchStoreSchema.parse(req.body);
      res.json({ success: true, data: await switchStore(auth.sellerId, storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const getStoreHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STORE_READ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const storeAuth = getStoreAuth(req);
      res.json({ success: true, data: await getStore(storeAuth.storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const updateStoreHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STORE_UPDATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const input = updateStoreSchema.parse(req.body);
      const seller = await getPrisma().sellerUser.findUnique({ where: { id: auth.sellerId } });
      const updated = await updateStore(
        storeAuth.storeId,
        auth.sellerId,
        seller?.email ?? null,
        input,
        getRequestMeta(req),
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
];

export const completeOnboardingHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STORE_UPDATE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const seller = await getPrisma().sellerUser.findUnique({ where: { id: auth.sellerId } });
      res.json({
        success: true,
        data: await completeOnboarding(
          storeAuth.storeId,
          auth.sellerId,
          seller?.email ?? null,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

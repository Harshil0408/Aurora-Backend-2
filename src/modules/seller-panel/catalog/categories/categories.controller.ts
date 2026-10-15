import type { Request, Response, NextFunction } from 'express';
import { getPrisma } from '../../../../config/db.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../../team/store-permissions.js';
import {
  applyAccessSchema,
  createCategoryRequestSchema,
  ownQueueQuerySchema,
  storeCategoryParamsSchema,
} from './categories.schemas.js';
import {
  applyForAccess,
  createCategoryRequest,
  getSellerTree,
  listAccessGrants,
  listCategoryRequests,
} from './categories.service.js';

async function actorEmail(sellerId: string): Promise<string | null> {
  const seller = await getPrisma().sellerUser.findUnique({ where: { id: sellerId } });
  return seller?.email ?? null;
}

export const sellerTreeHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.CATEGORY_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await getSellerTree(getStoreAuth(req).storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const createRequestHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.CATEGORY_REQUEST),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const input = createCategoryRequestSchema.parse(req.body);
      const created = await createCategoryRequest(
        storeAuth.storeId,
        auth.sellerId,
        await actorEmail(auth.sellerId),
        input,
        getRequestMeta(req),
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
];

export const listRequestsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.CATEGORY_REQUEST),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = ownQueueQuerySchema.parse(req.query);
      res.json({ success: true, data: await listCategoryRequests(getStoreAuth(req).storeId, status) });
    } catch (err) {
      next(err);
    }
  },
];

export const applyAccessHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.CATEGORY_REQUEST),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { storeId, categoryId } = storeCategoryParamsSchema.parse(req.params);
      const auth = getSellerAuth(req);
      const input = applyAccessSchema.parse(req.body);
      const created = await applyForAccess(
        storeId,
        categoryId,
        auth.sellerId,
        await actorEmail(auth.sellerId),
        input,
        getRequestMeta(req),
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
];

export const listAccessHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.CATEGORY_REQUEST),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = ownQueueQuerySchema.parse(req.query);
      res.json({ success: true, data: await listAccessGrants(getStoreAuth(req).storeId, status) });
    } catch (err) {
      next(err);
    }
  },
];

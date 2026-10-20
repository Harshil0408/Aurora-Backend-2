import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../../team/store-permissions.js';
import {
  applyBrandAccessSchema,
  createBrandRequestSchema,
  ownQueueQuerySchema,
  sellerListBrandsQuerySchema,
  storeBrandParamsSchema,
} from './brands.schemas.js';
import {
  applyForAuthorisation,
  createBrandRequest,
  getBrandAccess,
  getSellerBrandList,
  listAuthorisations,
  listBrandRequests,
} from './brands.service.js';

async function actorEmail(sellerId: string): Promise<string | null> {
  const { getPrisma } = await import('../../../../config/db.js');
  const seller = await getPrisma().sellerUser.findUnique({ where: { id: sellerId } });
  return seller?.email ?? null;
}

export const listSellerBrandsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_VIEW),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const storeAuth = getStoreAuth(req);
    const query = sellerListBrandsQuerySchema.parse(req.query);
    const { data, pagination } = await getSellerBrandList(storeAuth.storeId, query);
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const createBrandRequestHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_REQUEST),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getSellerAuth(req);
    const storeAuth = getStoreAuth(req);
    const input = createBrandRequestSchema.parse(req.body);
    const created = await createBrandRequest(
      storeAuth.storeId,
      auth.sellerId,
      await actorEmail(auth.sellerId),
      input,
      getRequestMeta(req),
    );
    res.status(201).json(ok(created));
  }),
];

export const listBrandRequestsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_REQUEST),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { status } = ownQueueQuerySchema.parse(req.query);
    const data = await listBrandRequests(getStoreAuth(req).storeId, status);
    res.status(200).json(ok(data));
  }),
];

export const listBrandAuthorisationsHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_REQUEST),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { status } = ownQueueQuerySchema.parse(req.query);
    const data = await listAuthorisations(getStoreAuth(req).storeId, status);
    res.status(200).json(ok(data));
  }),
];

export const applyBrandAccessHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_REQUEST),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getSellerAuth(req);
    const storeAuth = getStoreAuth(req);
    const { brandId } = storeBrandParamsSchema.parse(req.params);
    const input = applyBrandAccessSchema.parse(req.body);
    const created = await applyForAuthorisation(
      storeAuth.storeId,
      brandId,
      auth.sellerId,
      await actorEmail(auth.sellerId),
      input,
      getRequestMeta(req),
    );
    res.status(201).json(ok(created));
  }),
];

/** Point lookup for the product form (Module 6 consumes this via API). */
export const brandAccessHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.BRAND_VIEW),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const storeAuth = getStoreAuth(req);
    const { brandId } = storeBrandParamsSchema.parse(req.params);
    const access = await getBrandAccess(storeAuth.storeId, brandId);
    res.status(200).json(ok({ brandId, access }));
  }),
];

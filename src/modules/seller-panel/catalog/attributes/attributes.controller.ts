import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../../team/store-permissions.js';
import { suggestOption, resolveCategoryAttributeSet } from './attributes.service.js';
import {
  sellerCategoryParamsSchema,
  sellerStoreAttributeParamsSchema,
  suggestOptionSchema,
} from './attributes.schemas.js';

async function actorEmail(sellerId: string): Promise<string | null> {
  const { getPrisma } = await import('../../../../config/db.js');
  const seller = await getPrisma().sellerUser.findUnique({ where: { id: sellerId } });
  return seller?.email ?? null;
}

export const resolveCategoryAttributeSetHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ATTRIBUTE_VIEW),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const storeAuth = getStoreAuth(req);
    const { categoryId } = sellerCategoryParamsSchema.parse(req.params);
    const resolved = await resolveCategoryAttributeSet(storeAuth.storeId, categoryId);
    res.status(200).json(ok(resolved));
  }),
];

export const suggestOptionHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.ATTRIBUTE_SUGGEST),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getSellerAuth(req);
    const storeAuth = getStoreAuth(req);
    const { attributeId } = sellerStoreAttributeParamsSchema.parse(req.params);
    const input = suggestOptionSchema.parse(req.body);
    const created = await suggestOption(
      storeAuth.storeId,
      auth.sellerId,
      await actorEmail(auth.sellerId),
      attributeId,
      input,
      getRequestMeta(req),
    );
    res.status(201).json(ok(created));
  }),
];

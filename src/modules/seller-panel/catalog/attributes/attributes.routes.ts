import { Router } from 'express';
import {
  resolveCategoryAttributeSetHandler,
  suggestOptionHandler,
} from './attributes.controller.js';

/**
 * Seller face of the product attribute system (Module 4):
 * - GET  /catalog/:storeId/categories/:categoryId/attribute-set
 *   (product-form source of truth; inherits the nearest ancestor set)
 * - POST /catalog/:storeId/attributes/:attributeId/options (suggestion queue)
 */
export const sellerAttributesRouter: Router = Router();

sellerAttributesRouter.get(
  '/:storeId/categories/:categoryId/attribute-set',
  ...resolveCategoryAttributeSetHandler,
);
sellerAttributesRouter.post('/:storeId/attributes/:attributeId/options', ...suggestOptionHandler);

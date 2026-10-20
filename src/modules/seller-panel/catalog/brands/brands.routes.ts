import { Router } from 'express';
import {
  applyBrandAccessHandler,
  brandAccessHandler,
  createBrandRequestHandler,
  listBrandAuthorisationsHandler,
  listBrandRequestsHandler,
  listSellerBrandsHandler,
} from './brands.controller.js';

/**
 * Seller face of the brand master (`:storeId` scoped — the tenant
 * middleware resolves + enforces membership on every route).
 */
export const sellerBrandsRouter: Router = Router();

sellerBrandsRouter.get('/:storeId/brands', ...listSellerBrandsHandler);
sellerBrandsRouter.get('/:storeId/brands/requests', ...listBrandRequestsHandler);
sellerBrandsRouter.post('/:storeId/brands/requests', ...createBrandRequestHandler);
sellerBrandsRouter.get('/:storeId/brands/authorisations', ...listBrandAuthorisationsHandler);
sellerBrandsRouter.post('/:storeId/brands/:brandId/authorisations', ...applyBrandAccessHandler);
sellerBrandsRouter.get('/:storeId/brands/:brandId/access', ...brandAccessHandler);

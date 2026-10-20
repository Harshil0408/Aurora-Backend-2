import { Router } from 'express';
import {
  createBrandHandler,
  exportBrandsHandler,
  getBrandHandler,
  importBrandsHandler,
  listBrandAuthorisationsHandler,
  listBrandRequestsHandler,
  listBrandsHandler,
  mergeBrandHandler,
  reviewBrandAuthorisationHandler,
  reviewBrandRequestHandler,
  setBrandStatusHandler,
  updateBrandHandler,
} from './brands.controller.js';

/**
 * Brand master (admin panel — Administration group).
 * Static queue/import/export routes register BEFORE /:id so the param
 * route never swallows them.
 */
export const brandsRouter: Router = Router();

brandsRouter.get('/brands/requests', ...listBrandRequestsHandler);
brandsRouter.patch('/brands/requests/:id', ...reviewBrandRequestHandler);
brandsRouter.get('/brands/authorisations', ...listBrandAuthorisationsHandler);
brandsRouter.patch('/brands/authorisations/:id', ...reviewBrandAuthorisationHandler);
brandsRouter.get('/brands/export', ...exportBrandsHandler);
brandsRouter.post('/brands/import', ...importBrandsHandler);
brandsRouter.get('/brands', ...listBrandsHandler);
brandsRouter.get('/brands/:id', ...getBrandHandler);
brandsRouter.post('/brands', ...createBrandHandler);
brandsRouter.patch('/brands/:id', ...updateBrandHandler);
brandsRouter.patch('/brands/:id/status', ...setBrandStatusHandler);
brandsRouter.post('/brands/:id/merge', ...mergeBrandHandler);

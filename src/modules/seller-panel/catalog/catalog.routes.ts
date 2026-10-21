import { Router } from 'express';
import { mediaRouter } from './media/media.routes.js';
import { sellerCategoriesRouter } from './categories/categories.routes.js';
import { sellerBrandsRouter } from './brands/brands.routes.js';
import { sellerAttributesRouter } from './attributes/attributes.routes.js';

/**
 * Catalog area — Phase 1 foundation (media + categories + brands +
 * attributes + tax). One composer per area, mirroring the team/billing
 * areas, so future catalog routers slot in without touching the panel root.
 */
export const catalogAreaRouter: Router = Router();

catalogAreaRouter.use('/', mediaRouter);
catalogAreaRouter.use('/', sellerCategoriesRouter);
catalogAreaRouter.use('/', sellerBrandsRouter);
catalogAreaRouter.use('/', sellerAttributesRouter);

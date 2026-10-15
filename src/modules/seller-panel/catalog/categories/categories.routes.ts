import { Router } from 'express';
import {
  applyAccessHandler,
  createRequestHandler,
  listAccessHandler,
  listRequestsHandler,
  sellerTreeHandler,
} from './categories.controller.js';

export const sellerCategoriesRouter: Router = Router();

sellerCategoriesRouter.get('/:storeId/categories/tree', ...sellerTreeHandler);
sellerCategoriesRouter.get('/:storeId/categories/requests', ...listRequestsHandler);
sellerCategoriesRouter.post('/:storeId/categories/requests', ...createRequestHandler);
sellerCategoriesRouter.get('/:storeId/categories/access', ...listAccessHandler);
sellerCategoriesRouter.post('/:storeId/categories/:categoryId/access', ...applyAccessHandler);

import { Router } from 'express';
import {
  createCategoryHandler,
  deleteCategoryHandler,
  exportCategoriesHandler,
  getCategoryHandler,
  importCategoriesHandler,
  listAccessGrantsHandler,
  listCategoriesHandler,
  categoryTreeHandler,
  listCategoryRequestsHandler,
  reviewAccessGrantHandler,
  reviewCategoryRequestHandler,
  setCategoryStatusHandler,
  updateCategoryHandler,
} from './categories.controller.js';

/**
 * Product category tree (admin panel → Administration group).
 * Static GETs (/tree, /export, /requests, /access) register BEFORE /:id
 * so the param route never swallows them.
 */
export const categoriesRouter: Router = Router();

categoriesRouter.get('/categories/tree', ...categoryTreeHandler);
categoriesRouter.get('/categories/export', ...exportCategoriesHandler);
categoriesRouter.post('/categories/import', ...importCategoriesHandler);
categoriesRouter.get('/categories/requests', ...listCategoryRequestsHandler);
categoriesRouter.patch('/categories/requests/:id', ...reviewCategoryRequestHandler);
categoriesRouter.get('/categories/access', ...listAccessGrantsHandler);
categoriesRouter.patch('/categories/access/:id', ...reviewAccessGrantHandler);
categoriesRouter.get('/categories', ...listCategoriesHandler);
categoriesRouter.get('/categories/:id', ...getCategoryHandler);
categoriesRouter.post('/categories', ...createCategoryHandler);
categoriesRouter.patch('/categories/:id', ...updateCategoryHandler);
categoriesRouter.patch('/categories/:id/status', ...setCategoryStatusHandler);
categoriesRouter.delete('/categories/:id', ...deleteCategoryHandler);

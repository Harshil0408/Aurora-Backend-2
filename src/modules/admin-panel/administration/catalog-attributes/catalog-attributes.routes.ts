import { Router } from 'express';
import {
  addOptionHandler,
  createProductAttributeHandler,
  deleteOptionHandler,
  deleteProductAttributeHandler,
  getProductAttributeHandler,
  listOptionSuggestionsHandler,
  listProductAttributesHandler,
  reorderOptionsHandler,
  reviewSuggestionHandler,
  setProductAttributeStatusHandler,
  updateOptionHandler,
  updateProductAttributeHandler,
} from './catalog-attributes.controller.js';

/**
 * Product attribute catalog (admin panel — Administration group, Module 4).
 * Deliberately mounted under `catalog-attributes` so it never collides with
 * the generic key-value lookup router at `/attributes` (type/key/label
 * dictionary). Static sub-resource routes register before `/options/:optionId`?
 * — every option route is nested under `/:id/options`, which is itself
 * longer than `/suggestions`, so ordering is: suggestions first.
 */
export const catalogAttributesRouter: Router = Router();

catalogAttributesRouter.get('/catalog-attributes/suggestions', ...listOptionSuggestionsHandler);
catalogAttributesRouter.patch(
  '/catalog-attributes/options/:optionId/review',
  ...reviewSuggestionHandler,
);
catalogAttributesRouter.get('/catalog-attributes', ...listProductAttributesHandler);
catalogAttributesRouter.post('/catalog-attributes', ...createProductAttributeHandler);
catalogAttributesRouter.get('/catalog-attributes/:id', ...getProductAttributeHandler);
catalogAttributesRouter.patch('/catalog-attributes/:id', ...updateProductAttributeHandler);
catalogAttributesRouter.patch(
  '/catalog-attributes/:id/status',
  ...setProductAttributeStatusHandler,
);
catalogAttributesRouter.delete('/catalog-attributes/:id', ...deleteProductAttributeHandler);
catalogAttributesRouter.post('/catalog-attributes/:id/options', ...addOptionHandler);
catalogAttributesRouter.patch('/catalog-attributes/:id/options/reorder', ...reorderOptionsHandler);
catalogAttributesRouter.patch('/catalog-attributes/:id/options/:optionId', ...updateOptionHandler);
catalogAttributesRouter.delete('/catalog-attributes/:id/options/:optionId', ...deleteOptionHandler);

import { Router } from 'express';
import {
  createAttributeHandler,
  deleteAttributeHandler,
  getAttributeHandler,
  listAttributeTypesHandler,
  listAttributesHandler,
  setAttributeStatusHandler,
  updateAttributeHandler,
} from './attributes.controller.js';

/**
 * Attributes screen routes (admin panel → Administration group).
 * One global lookup catalog namespaced by `type`: categories,
 * payment types, countries, languages, … Mounted under /api/v1/admin
 * via administrationRouter. The static GET (/types) is registered
 * BEFORE /:id so the param route never swallows it.
 */
export const attributesRouter: Router = Router();

attributesRouter.get('/attributes/types', ...listAttributeTypesHandler);
attributesRouter.get('/attributes', ...listAttributesHandler);
attributesRouter.get('/attributes/:id', ...getAttributeHandler);
attributesRouter.post('/attributes', ...createAttributeHandler);
attributesRouter.patch('/attributes/:id', ...updateAttributeHandler);
attributesRouter.patch('/attributes/:id/status', ...setAttributeStatusHandler);
attributesRouter.delete('/attributes/:id', ...deleteAttributeHandler);

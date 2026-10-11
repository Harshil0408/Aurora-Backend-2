import { Router } from 'express';
import {
  getPublicAttributeHandler,
  listPublicAttributeTypesHandler,
  listPublicAttributesHandler,
} from './public-attributes.controller.js';

/**
 * Public attributes routes — read-only, no auth. The static GET (/types)
 * is registered BEFORE /:id so the param route never swallows it.
 */
export const publicAttributesRouter: Router = Router();

publicAttributesRouter.get('/attributes/types', listPublicAttributeTypesHandler);
publicAttributesRouter.get('/attributes', listPublicAttributesHandler);
publicAttributesRouter.get('/attributes/:id', getPublicAttributeHandler);

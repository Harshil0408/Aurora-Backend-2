import { Router } from 'express';
import {
  attachItemHandler,
  cloneAttributeSetHandler,
  createAttributeSetHandler,
  createGroupHandler,
  deleteAttributeSetHandler,
  deleteGroupHandler,
  detachItemHandler,
  getAttributeSetHandler,
  listAttributeSetsHandler,
  reorderItemsHandler,
  setAttributeSetStatusHandler,
  updateAttributeSetHandler,
  updateGroupHandler,
  updateItemHandler,
} from './attribute-sets.controller.js';

/**
 * Attribute sets (admin panel — Administration group, Module 4).
 * Static action routes (clone) register before the `/:id/items` nests so
 * param routes never swallow them. Group and item routes are nested under
 * `/:id/groups` / `/:id/items`, and `/reorder` variants register before the
 * matching param routes.
 */
export const attributeSetsRouter: Router = Router();

attributeSetsRouter.get('/attribute-sets', ...listAttributeSetsHandler);
attributeSetsRouter.post('/attribute-sets', ...createAttributeSetHandler);
attributeSetsRouter.get('/attribute-sets/:id', ...getAttributeSetHandler);
attributeSetsRouter.patch('/attribute-sets/:id', ...updateAttributeSetHandler);
attributeSetsRouter.patch('/attribute-sets/:id/status', ...setAttributeSetStatusHandler);
attributeSetsRouter.delete('/attribute-sets/:id', ...deleteAttributeSetHandler);
attributeSetsRouter.post('/attribute-sets/:id/clone', ...cloneAttributeSetHandler);

attributeSetsRouter.post('/attribute-sets/:id/groups', ...createGroupHandler);
attributeSetsRouter.patch('/attribute-sets/:id/groups/:groupId', ...updateGroupHandler);
attributeSetsRouter.delete('/attribute-sets/:id/groups/:groupId', ...deleteGroupHandler);

attributeSetsRouter.post('/attribute-sets/:id/items', ...attachItemHandler);
attributeSetsRouter.patch('/attribute-sets/:id/items/reorder', ...reorderItemsHandler);
attributeSetsRouter.patch('/attribute-sets/:id/items/:itemId', ...updateItemHandler);
attributeSetsRouter.delete('/attribute-sets/:id/items/:itemId', ...detachItemHandler);

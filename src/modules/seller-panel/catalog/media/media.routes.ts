import { Router } from 'express';
import {
  cleanupOrphansHandler,
  deleteMediaHandler,
  downloadMediaHandler,
  listMediaHandler,
  quotaHandler,
  updateMediaHandler,
  uploadMediaHandler,
} from './media.controller.js';

export const mediaRouter: Router = Router();

// Static-segment routes before `:id` so they are never swallowed.
mediaRouter.get('/:storeId/media/quota', ...quotaHandler);
mediaRouter.post('/:storeId/media/orphans/cleanup', ...cleanupOrphansHandler);
mediaRouter.get('/:storeId/media', ...listMediaHandler);
mediaRouter.post('/:storeId/media', ...uploadMediaHandler);
mediaRouter.get('/:storeId/media/:id/file', ...downloadMediaHandler);
mediaRouter.patch('/:storeId/media/:id', ...updateMediaHandler);
mediaRouter.delete('/:storeId/media/:id', ...deleteMediaHandler);

import { Router } from 'express';
import { mediaRouter } from './media/media.routes.js';

/**
 * Catalog area — Phase 1 foundation (media → categories → brands →
 * attributes → tax). One composer per area, mirroring the team/billing
 * areas, so future catalog routers slot in without touching the panel root.
 */
export const catalogAreaRouter: Router = Router();

catalogAreaRouter.use('/', mediaRouter);

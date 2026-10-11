import { Router } from 'express';
import { publicAttributesRouter } from './attributes/public-attributes.routes.js';

/**
 * Public panel — owns the entire `/api/v1/public/*` namespace.
 *
 * Read-only catalog data (attributes lookups, …) with no auth, usable from
 * the storefront, seller panel, or anywhere else. Nothing here mutates
 * state; all reads are scoped to ACTIVE rows. `app.ts` mounts ONE router
 * for this panel, same as admin/seller.
 */
export const publicPanelRouter: Router = Router();

publicPanelRouter.use('/', publicAttributesRouter);

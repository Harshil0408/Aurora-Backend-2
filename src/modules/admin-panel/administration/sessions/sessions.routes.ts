import { Router } from 'express';
import { listMySessionsHandler, revokeOneSessionHandler } from './sessions.controller.js';

/**
 * Sessions screen routes ("My sessions" table).
 * Mounted under /api/v1/admin/auth in app.ts — the URLs are unchanged,
 * only the code moved here from the auth area.
 */
export const adminSessionsRouter: Router = Router();

adminSessionsRouter.get('/sessions', ...listMySessionsHandler);
adminSessionsRouter.delete('/sessions/:id', ...revokeOneSessionHandler);

import { Router } from 'express';
import { authRouter } from './auth/routes/auth.routes.js';
import { administrationRouter } from './administration/administration.routes.js';
import { adminSessionsRouter } from './administration/sessions/sessions.routes.js';

/**
 * Admin panel — owns the entire `/api/v1/admin/*` namespace.
 *
 * Identity (`/auth/*`: login, 2FA, sessions, passwords, me) and the
 * administration screens (admins, roles, activity log) compose here, so
 * `app.ts` mounts ONE router per panel. Future panels (seller, user, …)
 * follow the same shape: `<panel>.routes.ts` + ONE `app.use` line.
 * Generic leaf names (`/login`, `/me`) are safe — the panel prefix
 * disambiguates them, so panels can never collide.
 */
export const adminPanelRouter: Router = Router();

adminPanelRouter.use('/auth', authRouter);
adminPanelRouter.use('/auth', adminSessionsRouter);
adminPanelRouter.use('/', administrationRouter);

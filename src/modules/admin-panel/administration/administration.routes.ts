import { Router } from 'express';
import { adminsRouter } from './admins/admins.routes.js';
import { rolesPermissionsRouter } from './roles-permissions/roles-permissions.routes.js';
import { activityLogRouter } from './activity-log/activity-log.routes.js';

/**
 * Administration group of the admin panel (mirrors the frontend sidebar group):
 * Admins, Roles & Permissions, Activity Log.
 * The Sessions screen router mounts separately under /api/v1/admin/auth
 * (same URLs as before) — see sessions/sessions.routes.ts.
 */
export const administrationRouter: Router = Router();

administrationRouter.use(adminsRouter);
administrationRouter.use(rolesPermissionsRouter);
administrationRouter.use(activityLogRouter);

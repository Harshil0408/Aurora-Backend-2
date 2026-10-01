import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../../../../shared/errors/AppError.js';
import { getAuth } from './requireAuth.js';
import { hasPermission } from '../../../rbac/permissions.js';

/**
 * Route guard: caller must hold the permission (super admin bypasses).
 * Accepts any `module.action` string — DB-created permissions authorize
 * without a code change; compiled `PERMISSIONS.*` constants are preferred
 * for existing keys so renames break at build time.
 */
export function requirePerm(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = getAuth(req);
      if (!hasPermission(auth.permissions, permission)) {
        throw forbidden('Insufficient permissions');
      }
      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}

/** Route guard: caller must hold AT LEAST ONE of the permissions. */
export function requireAnyPerm(permissions: readonly string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = getAuth(req);
      const allowed = permissions.some((p) => hasPermission(auth.permissions, p));
      if (!allowed) {
        throw forbidden('Insufficient permissions');
      }
      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}

/** Route guard: caller must hold ALL of the permissions. */
export function requireAllPerms(permissions: readonly string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = getAuth(req);
      const allowed = permissions.every((p) => hasPermission(auth.permissions, p));
      if (!allowed) {
        throw forbidden('Insufficient permissions');
      }
      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}

import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../../../shared/errors/AppError.js';
import type { PermissionKey } from '../../rbac/permissions.js';
import { getAuth } from './requireAuth.js';
import { hasPermission } from '../../rbac/permissions.js';

/** Route guard: caller must hold the permission (super admin bypasses). */
export function requirePerm(permission: PermissionKey) {
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

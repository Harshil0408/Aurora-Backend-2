import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../../../../shared/errors/AppError.js';
import { getSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStorePermissions, type StoreMembershipContext } from '../store-rbac.service.js';

export interface StoreAuthContext extends StoreMembershipContext {
  storeId: string;
}

declare global {
  namespace Express {
    interface Request {
      storeAuth?: StoreAuthContext;
    }
  }
}

function resolveStoreId(req: Request): string {
  const fromParams = (req.params as Record<string, string | undefined>)['storeId'];
  if (fromParams && fromParams.length > 0) return fromParams;
  const fromBody = (req.body as { storeId?: unknown } | undefined)?.storeId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  throw forbidden('Store context missing');
}

/**
 * Tenant boundary: verifies the authenticated seller holds an ACTIVE
 * membership in the requested store AND (optionally) the required
 * `resource:action` permission. The frontend's active-store selection is
 * never trusted — membership is re-validated against the DB/cache here,
 * and services must use `req.storeAuth.storeId` (never a client storeId).
 */
export function requireStoreAccess(requiredPermission?: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      const seller = getSellerAuth(req);
      const storeId = resolveStoreId(req);
      const membership = await getStorePermissions(storeId, seller.sellerId);
      if (!membership) throw forbidden('No access to this store');
      if (
        requiredPermission &&
        !membership.isOwner &&
        !membership.permissions.has(requiredPermission)
      ) {
        throw forbidden('Insufficient store permissions');
      }
      req.storeAuth = { ...membership, storeId };
      next();
    })().catch(next);
  };
}

export function getStoreAuth(req: Request): StoreAuthContext {
  if (!req.storeAuth) throw forbidden('Store context required');
  return req.storeAuth;
}

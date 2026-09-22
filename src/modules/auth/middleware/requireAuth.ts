import type { NextFunction, Request, Response } from 'express';
import { getPrisma } from '../../../config/db.js';
import { forbidden, unauthorized } from '../../../shared/errors/AppError.js';
import { verifyAccessToken } from '../crypto/tokens.js';
import { getEffectivePermissions } from '../../rbac/rbac.service.js';

export interface AuthContext {
  adminId: string;
  sessionId: string;
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Authenticates short-lived access JWTs AND revalidates them against the
 * database: admin must be ACTIVE, tokenVersion must match (global logout),
 * and the bound session must be live. JWT claims alone are never trusted.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing or invalid authorization header');
    }
    const verified = verifyAccessToken(header.slice('Bearer '.length).trim());
    if (!verified.valid) throw unauthorized('Invalid or expired token');

    const prisma = getPrisma();
    const admin = await prisma.adminUser.findUnique({
      where: { id: verified.claims.sub },
    });
    if (!admin || admin.status !== 'ACTIVE' || admin.tokenVersion !== verified.claims.tv) {
      throw unauthorized('Invalid or expired token');
    }
    const session = await prisma.adminSession.findUnique({
      where: { id: verified.claims.sid },
    });
    if (
      !session ||
      session.adminId !== admin.id ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw unauthorized('Session expired or revoked');
    }

    req.auth = {
      adminId: admin.id,
      sessionId: session.id,
      permissions: await getEffectivePermissions(admin.id),
    };
    next();
  })().catch(next);
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw forbidden('Authentication required');
  return req.auth;
}

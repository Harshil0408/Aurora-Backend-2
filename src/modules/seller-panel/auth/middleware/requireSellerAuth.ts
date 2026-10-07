import type { NextFunction, Request, Response } from 'express';
import { getPrisma } from '../../../../config/db.js';
import { forbidden, unauthorized } from '../../../../shared/errors/AppError.js';
import { verifySellerAccessToken } from '../crypto/tokens.js';

export interface SellerAuthContext {
  sellerId: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      seller?: SellerAuthContext;
    }
  }
}

export function requireSellerAuth(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer '))
      throw unauthorized('Missing or invalid authorization header');
    const verified = verifySellerAccessToken(header.slice('Bearer '.length).trim());
    if (!verified.valid) throw unauthorized('Invalid or expired token');

    const prisma = getPrisma();
    const seller = await prisma.sellerUser.findUnique({ where: { id: verified.claims.sub } });
    if (!seller || seller.status !== 'ACTIVE' || seller.tokenVersion !== verified.claims.tv) {
      throw unauthorized('Invalid or expired token');
    }
    const session = await prisma.sellerSession.findUnique({
      where: { id: verified.claims.sid },
    });
    if (
      !session ||
      session.sellerId !== seller.id ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw unauthorized('Session expired or revoked');
    }

    req.seller = { sellerId: seller.id, sessionId: session.id };
    next();
  })().catch(next);
}

export function getSellerAuth(req: Request): SellerAuthContext {
  if (!req.seller) throw forbidden('Authentication required');
  return req.seller;
}

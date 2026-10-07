import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { getEnv } from '../../../config/env.js';
import { getRequestMeta } from '../../../shared/utils/requestMeta.js';
import { getSellerProfile, loginSeller, registerSeller } from './seller-auth.service.js';
import {
  listSellerSessions,
  revokeAllSellerSessions,
  revokeSellerSession,
  rotateSellerSession,
  SELLER_REFRESH_COOKIE,
} from './seller-session.service.js';
import { registerSchema, sellerLoginSchema } from './seller-auth.schemas.js';
import { getSellerAuth, requireSellerAuth } from './middleware/requireSellerAuth.js';

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = registerSchema.parse(req.body);
    const result = await registerSeller(input, getRequestMeta(req));
    res.cookie(SELLER_REFRESH_COOKIE, result.refreshToken, cookieOptions());
    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = sellerLoginSchema.parse(req.body);
    const result = await loginSeller(input, getRequestMeta(req));
    res.cookie(SELLER_REFRESH_COOKIE, result.refreshToken, cookieOptions());
    res.json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
      },
    });
  } catch (err) {
    next(err);
  }
}

export const meHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      res.json({ success: true, data: await getSellerProfile(auth.sellerId) });
    } catch (err) {
      next(err);
    }
  },
];

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const presented = req.cookies?.[SELLER_REFRESH_COOKIE] as string | undefined;
    if (!presented) {
      res
        .status(401)
        .json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } });
      return;
    }
    const issued = await rotateSellerSession(presented, getRequestMeta(req));
    res.cookie(SELLER_REFRESH_COOKIE, issued.refreshToken, cookieOptions());
    res.json({
      success: true,
      data: { accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds },
    });
  } catch (err) {
    next(err);
  }
}

export const logoutHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      await revokeSellerSession(auth.sessionId, auth.sellerId);
      res.clearCookie(SELLER_REFRESH_COOKIE, { path: '/' });
      res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      next(err);
    }
  },
];

export const logoutAllHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      await revokeAllSellerSessions(auth.sellerId);
      res.clearCookie(SELLER_REFRESH_COOKIE, { path: '/' });
      res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      next(err);
    }
  },
];

export const listSessionsHandler = [
  requireSellerAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const page = Math.max(1, Number(req.query['page'] ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query['limit'] ?? 20) || 20));
      const result = await listSellerSessions(auth.sellerId, page, limit);
      res.json({ success: true, data: result.data, meta: { total: result.total, page, limit } });
    } catch (err) {
      next(err);
    }
  },
];

export function sellerLoginLimiter(): ReturnType<typeof rateLimit> {
  const env = getEnv();
  return rateLimit({
    windowMs: 15 * 60_000,
    max: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  });
}

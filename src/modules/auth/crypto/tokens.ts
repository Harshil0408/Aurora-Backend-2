import { randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { getEnv } from '../../../config/env.js';

export interface AccessTokenClaims {
  /** Admin id (subject). */
  sub: string;
  /** Session id (refresh family row) — binds access token to a session. */
  sid: string;
  /** Token version copied from admin — bump revokes all outstanding JWTs. */
  tv: number;
  /** Granted permission keys (frozen at login; re-checked server-side for writes). */
  perms: string[];
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  tv: z.number().int().nonnegative(),
  perms: z.array(z.string()),
});

/**
 * Short-lived (default 5 min) signed access token. Stateless verification;
 * revocation is enforced via `tv` (tokenVersion) + `sid` lookups on the
 * refresh path and for sensitive operations.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  const env = getEnv();
  const parsed = claimsSchema.parse(claims);
  return jwt.sign(parsed, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: 'ecomm-admin',
    audience: 'ecomm-admin-panel',
  });
}

export type VerifyAccessResult =
  { valid: true; claims: AccessTokenClaims } | { valid: false; reason: 'expired' | 'invalid' };

export function verifyAccessToken(token: string): VerifyAccessResult {
  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'ecomm-admin',
      audience: 'ecomm-admin-panel',
    }) as JwtPayload;
    const parsed = claimsSchema.safeParse({
      sub: decoded['sub'],
      sid: decoded['sid'],
      tv: decoded['tv'],
      perms: decoded['perms'],
    });
    if (!parsed.success) return { valid: false, reason: 'invalid' };
    return { valid: true, claims: parsed.data };
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) return { valid: false, reason: 'expired' };
    return { valid: false, reason: 'invalid' };
  }
}

/** 256-bit opaque refresh token (base64url). Only its hash is ever stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

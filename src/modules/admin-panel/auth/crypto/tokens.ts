import { randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { getEnv } from '../../../../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  tv: number;
  perms: string[];
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  tv: z.number().int().nonnegative(),
  perms: z.array(z.string()),
});

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

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export const PENDING_TOKEN_PURPOSE = '2fa-pending';
export const PENDING_TOKEN_TTL_SECONDS = 300;

const pendingClaimsSchema = z.object({
  sub: z.string().min(1),
  purpose: z.literal(PENDING_TOKEN_PURPOSE),
});

export function signPendingToken(adminId: string): string {
  const env = getEnv();
  return jwt.sign({ sub: adminId, purpose: PENDING_TOKEN_PURPOSE }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: PENDING_TOKEN_TTL_SECONDS,
    issuer: 'ecomm-admin',
    audience: 'ecomm-admin-2fa',
  });
}

export type VerifyPendingResult =
  { valid: true; adminId: string } | { valid: false; reason: 'expired' | 'invalid' };

export function verifyPendingToken(token: string): VerifyPendingResult {
  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'ecomm-admin',
      audience: 'ecomm-admin-2fa',
    }) as JwtPayload;
    const parsed = pendingClaimsSchema.safeParse({
      sub: decoded['sub'],
      purpose: decoded['purpose'],
    });
    if (!parsed.success) return { valid: false, reason: 'invalid' };
    return { valid: true, adminId: parsed.data.sub };
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) return { valid: false, reason: 'expired' };
    return { valid: false, reason: 'invalid' };
  }
}

import { randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { getEnv } from '../../../../config/env.js';

export interface SellerAccessClaims {
  sub: string;
  sid: string;
  tv: number;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  tv: z.number().int().nonnegative(),
});

const ISSUER = 'ecomm-seller';
const AUDIENCE = 'ecomm-seller-panel';

export function signSellerAccessToken(claims: SellerAccessClaims): string {
  const env = getEnv();
  const parsed = claimsSchema.parse(claims);
  return jwt.sign(parsed, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export type VerifySellerAccessResult =
  { valid: true; claims: SellerAccessClaims } | { valid: false; reason: 'expired' | 'invalid' };

export function verifySellerAccessToken(token: string): VerifySellerAccessResult {
  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;
    const parsed = claimsSchema.safeParse({
      sub: decoded['sub'],
      sid: decoded['sid'],
      tv: decoded['tv'],
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

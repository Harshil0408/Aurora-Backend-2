import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../../config/env.js';

/**
 * Refresh / password-reset tokens are opaque random strings. We store only
 * an HMAC-SHA256 (keyed by REFRESH_TOKEN_PEPPER) so a database read alone
 * never yields a usable token — unlike a plain SHA-256, HMAC resists
 * rainbow tables even for lower-entropy tokens.
 */
export function hashToken(token: string): string {
  const env = getEnv();
  return createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token, 'utf8').digest('hex');
}

export function tokensEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

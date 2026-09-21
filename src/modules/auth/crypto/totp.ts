import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { getEnv } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

const TOTP_ISSUER = 'EComm Admin';
const TOTP_WINDOW = 1; // ±30s clock skew tolerance

/**
 * TOTP secrets are encrypted with AES-256-GCM before storage.
 * Key: 64-hex chars (32 bytes) via TOTP_ENCRYPTION_KEY in production.
 * Dev fallback (non-hex value): SHA-256 of the value — logged as a
 * warning; production deployments MUST set a real 64-hex key.
 */
function getKey(): Buffer {
  const raw = getEnv().TOTP_ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  logger.warn('TOTP_ENCRYPTION_KEY is not a 64-hex production key — deriving dev key');
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** AES-256-GCM encrypt; format `ivHex:cipherHex:tagHex`. */
export function encryptTotpSecret(plaintextBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintextBase32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

/** Returns null (never throws) on tampered/malformed input. */
export function decryptTotpSecret(stored: string): string | null {
  try {
    const parts = stored.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, encHex, tagHex] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export interface TotpEnrollment {
  /** Base32 secret — shown ONCE (QR), then only the encrypted form is kept. */
  secretBase32: string;
  encryptedSecret: string;
  otpauthUrl: string;
}

/** 160-bit secret per RFC 4226 (GOOGLE_AUTH-compatible). */
export function beginTotpEnrollment(adminEmail: string): TotpEnrollment {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: adminEmail,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return {
    secretBase32: secret.base32,
    encryptedSecret: encryptTotpSecret(secret.base32),
    otpauthUrl: totp.toString(),
  };
}

/** Verify a 6-digit code against the DECRYPTED base32 secret. */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: 'verify',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    return totp.validate({ token: code.trim(), window: TOTP_WINDOW }) !== null;
  } catch {
    return false;
  }
}

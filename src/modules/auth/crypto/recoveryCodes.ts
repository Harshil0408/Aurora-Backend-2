import { randomBytes } from 'node:crypto';
import { hashSecret, verifySecret } from './password.js';

export const RECOVERY_CODE_COUNT = 10;

/**
 * Single-use recovery codes: `XXXXXX-XXXXXX` (Crockford-ish, unambiguous
 * alphabet, ~64 bits each). Plaintext is shown ONCE at enrollment;
 * only Argon2id hashes are stored; each hash is deleted on use.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const pick = (): string => {
      let out = '';
      const bytes = randomBytes(8);
      for (const b of bytes) out += alphabet[(b as number) % alphabet.length];
      return out;
    };
    codes.push(`${pick().slice(0, 6)}-${pick().slice(0, 6)}`);
  }
  return codes;
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashSecret(normalizeRecoveryCode(c))));
}

/** Case/space/hyphen-insensitive compare; false on any error. */
export async function verifyRecoveryCode(storedHash: string, candidate: string): Promise<boolean> {
  return verifySecret(storedHash, normalizeRecoveryCode(candidate));
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from '../src/modules/auth/crypto/password.js';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from '../src/modules/auth/crypto/recoveryCodes.js';
import { hashToken } from '../src/modules/auth/crypto/tokenHash.js';
import {
  generateRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../src/modules/auth/crypto/tokens.js';
import {
  beginTotpEnrollment,
  decryptTotpSecret,
  encryptTotpSecret,
  verifyTotpCode,
} from '../src/modules/auth/crypto/totp.js';
import { normalizeEmail } from '../src/modules/auth/utils/email.js';
import {
  expandRolePermissions,
  hasPermission,
  PERMISSIONS,
  SUPER_ADMIN_ROLE_KEY,
} from '../src/modules/rbac/permissions.js';

const claims: AccessTokenClaims = {
  sub: 'admin-1',
  sid: 'sess-1',
  tv: 0,
  perms: [PERMISSIONS.ADMIN_READ],
};

describe('password hashing (argon2id)', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const h = await hashSecret('Correct-Horse-123!');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(h, 'Correct-Horse-123!')).toBe(true);
    expect(await verifySecret(h, 'wrong-password')).toBe(false);
  });

  it('returns false (never throws) for malformed stored hashes', async () => {
    expect(await verifySecret('not-a-hash', 'anything')).toBe(false);
    expect(await verifySecret('', 'anything')).toBe(false);
  });

  it('produces unique salts per hash', async () => {
    const a = await hashSecret('same-password');
    const b = await hashSecret('same-password');
    expect(a).not.toBe(b);
  });
});

describe('access tokens (jwt)', () => {
  it('sign/verify roundtrip preserves claims', () => {
    const token = signAccessToken(claims);
    const res = verifyAccessToken(token);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.claims).toMatchObject(claims);
  });

  it('rejects tampered tokens as invalid (not expired)', () => {
    const token = signAccessToken(claims);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyAccessToken(tampered)).toEqual({ valid: false, reason: 'invalid' });
  });

  it('rejects empty and garbage input', () => {
    expect(verifyAccessToken('')).toEqual({ valid: false, reason: 'invalid' });
    expect(verifyAccessToken('a.b.c')).toEqual({ valid: false, reason: 'invalid' });
  });

  it('generates unique opaque refresh tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hashes refresh tokens deterministically (hmac, peppered)', () => {
    expect(hashToken('tok')).toBe(hashToken('tok'));
    expect(hashToken('tok')).not.toBe(hashToken('tok2'));
  });
});

describe('totp secrets (aes-256-gcm + totp)', () => {
  it('encrypt/decrypt roundtrips; tampering returns null', () => {
    const enc = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(enc.slice(0, -2) + 'ff')).toBeNull();
    expect(decryptTotpSecret('garbage')).toBeNull();
    expect(decryptTotpSecret('a:b')).toBeNull();
  });

  it('enrollment issues a unique secret + valid otpauth url', () => {
    const a = beginTotpEnrollment('admin@example.com');
    const b = beginTotpEnrollment('admin@example.com');
    expect(a.secretBase32).not.toBe(b.secretBase32);
    expect(a.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    expect(decryptTotpSecret(a.encryptedSecret)).toBe(a.secretBase32);
  });

  it('rejects malformed codes without touching crypto', () => {
    expect(verifyTotpCode('JBSWY3DPEHPK3PXP', '12345')).toBe(false);
    expect(verifyTotpCode('JBSWY3DPEHPK3PXP', 'abcdef')).toBe(false);
    expect(verifyTotpCode('!!!not-base32!!!', '123456')).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates unique codes that verify after hashing', async () => {
    const codes = generateRecoveryCodes(4);
    expect(new Set(codes).size).toBe(4);
    const hashes = await hashRecoveryCodes(codes);
    for (let i = 0; i < codes.length; i++) {
      expect(await verifyRecoveryCode(hashes[i] as string, codes[i] as string)).toBe(true);
    }
    expect(await verifyRecoveryCode(hashes[0] as string, codes[1] as string)).toBe(false);
  });

  it('comparison is case/format-insensitive', async () => {
    const [hash] = await hashRecoveryCodes(['ABCDEF-GHIJKL']);
    expect(await verifyRecoveryCode(hash as string, 'abcdef ghijkl')).toBe(true);
    expect(normalizeRecoveryCode(' ab-cd ef ')).toBe('ABCDEF');
  });
});

describe('email normalization', () => {
  it('trims and lowercases; does not strip dots/plus tags', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
    expect(normalizeEmail('first.last+tag@gmail.com')).toBe('first.last+tag@gmail.com');
  });
});

describe('permission evaluation', () => {
  it('super admin passes every check', () => {
    const granted = new Set([SUPER_ADMIN_ROLE_KEY]);
    expect(hasPermission(granted, PERMISSIONS.ROLE_ASSIGN)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.AUDIT_READ)).toBe(true);
  });

  it('grants only explicitly held permissions otherwise', () => {
    const granted = new Set([PERMISSIONS.ADMIN_READ]);
    expect(hasPermission(granted, PERMISSIONS.ADMIN_READ)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ADMIN_SUSPEND)).toBe(false);
    expect(hasPermission(new Set(), PERMISSIONS.ADMIN_READ)).toBe(false);
  });

  it('expands role keys to permission sets; unknown roles grant nothing', () => {
    expect(expandRolePermissions([SUPER_ADMIN_ROLE_KEY]).size).toBeGreaterThan(5);
    const support = expandRolePermissions(['support']);
    expect(support.has(PERMISSIONS.ADMIN_READ)).toBe(true);
    expect(support.has(PERMISSIONS.ROLE_ASSIGN)).toBe(false);
    expect(expandRolePermissions(['nope']).size).toBe(0);
  });
});

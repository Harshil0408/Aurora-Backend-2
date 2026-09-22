import * as OTPAuth from 'otpauth';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../../src/config/db.js';
import { decryptTotpSecret } from '../../src/modules/auth/crypto/totp.js';

export interface AuthedSession {
  accessToken: string;
  refreshCookie: string;
}

function extractRefreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const entry = raw?.find((c) => c.startsWith('admin_rt='));
  if (!entry) throw new Error('refresh cookie missing in response');
  const pair = entry.split(';')[0] as string;
  return pair;
}

/** Step 1: password → pending token. */
export async function passwordStep(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/admin/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login step 1 failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.pendingToken as string;
}

/** Read the enrolled (encrypted) secret and mint the current TOTP code. */
export async function currentTotpCode(adminId: string): Promise<string> {
  const admin = await getPrisma().adminUser.findUniqueOrThrow({ where: { id: adminId } });
  if (!admin.totpSecretEncrypted) throw new Error('no enrolled secret');
  const secret = decryptTotpSecret(admin.totpSecretEncrypted);
  if (!secret) throw new Error('cannot decrypt test secret');
  return new OTPAuth.TOTP({
    issuer: 'EComm Admin',
    label: 'test',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

export async function adminIdFor(email: string): Promise<string> {
  const admin = await getPrisma().adminUser.findUniqueOrThrow({
    where: { emailNormalized: email.trim().toLowerCase() },
  });
  return admin.id;
}

/**
 * Full login: password → enroll (if needed) → confirm → verify.
 * Returns access token + refresh cookie. Recovery codes returned on
 * first enrollment for single-use tests.
 */
export async function fullLogin(
  app: Express,
  email: string,
  password: string,
): Promise<AuthedSession & { recoveryCodes: string[] }> {
  const pending = await passwordStep(app, email, password);
  const id = await adminIdFor(email);
  const admin = await getPrisma().adminUser.findUniqueOrThrow({ where: { id } });

  let recoveryCodes: string[] = [];
  if (!admin.totpEnabled) {
    const enroll = await request(app)
      .post('/api/v1/admin/auth/2fa/enroll')
      .send({ pendingToken: pending });
    if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
    recoveryCodes = enroll.body.data.recoveryCodes as string[];
    const code = await currentTotpCode(id);
    const confirm = await request(app)
      .post('/api/v1/admin/auth/2fa/confirm')
      .send({ pendingToken: pending, code });
    if (confirm.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(confirm.body)}`);
  }

  const code = await currentTotpCode(id);
  const verify = await request(app)
    .post('/api/v1/admin/auth/2fa/verify')
    .send({ pendingToken: pending, code });
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  return {
    accessToken: verify.body.data.accessToken as string,
    refreshCookie: extractRefreshCookie(verify),
    recoveryCodes,
  };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

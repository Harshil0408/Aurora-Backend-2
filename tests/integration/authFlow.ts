import * as OTPAuth from 'otpauth';
import request from 'supertest';
import type { Express } from 'express';
import { getPrisma } from '../../src/config/db.js';
import { decryptTotpSecret } from '../../src/modules/admin-panel/auth/crypto/totp.js';

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

/** Step 1: password → pending token (only when a 2FA method is enabled). */
export async function passwordStep(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/admin/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login step 1 failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (res.body.data.requires2fa !== true)
    throw new Error('expected a 2FA-pending token — is any 2FA method enabled?');
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
 * Enable TOTP for a logged-in admin (Security page flow): enroll → confirm.
 * Returns the one-time recovery codes.
 */
export async function enableTotpAuthed(
  app: Express,
  accessToken: string,
  adminId: string,
): Promise<string[]> {
  const enroll = await request(app)
    .post('/api/v1/admin/auth/2fa/totp/enroll')
    .set(authHeader(accessToken))
    .send({});
  if (enroll.status !== 200) throw new Error(`totp enroll failed: ${JSON.stringify(enroll.body)}`);
  const confirm = await request(app)
    .post('/api/v1/admin/auth/2fa/totp/confirm')
    .set(authHeader(accessToken))
    .send({ code: await currentTotpCode(adminId) });
  if (confirm.status !== 200)
    throw new Error(`totp confirm failed: ${JSON.stringify(confirm.body)}`);
  return enroll.body.data.recoveryCodes as string[];
}

/**
 * Full login: password → session. 2FA is optional — admins with no method
 * get a session directly; TOTP-enabled admins go through enroll (if needed)
 * → confirm → verify. Always ends with TOTP enabled + a valid session
 * (email-OTP-only admins are out of scope — handle their code explicitly).
 * Returns access token + refresh cookie. Recovery codes returned when this
 * helper performed the (first) enrollment.
 */
export async function fullLogin(
  app: Express,
  email: string,
  password: string,
): Promise<AuthedSession & { recoveryCodes: string[] }> {
  const res = await request(app).post('/api/v1/admin/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);

  // Direct session — no 2FA method enabled yet.
  if (res.body.data.requires2fa === false) {
    const accessToken = res.body.data.accessToken as string;
    const id = await adminIdFor(email);
    const admin = await getPrisma().adminUser.findUniqueOrThrow({ where: { id } });
    const recoveryCodes = admin.totpEnabled ? [] : await enableTotpAuthed(app, accessToken, id);
    return { accessToken, refreshCookie: extractRefreshCookie(res), recoveryCodes };
  }

  if (res.body.data.channel === 'email_otp') {
    throw new Error('fullLogin cannot complete email-OTP challenges — verify the code explicitly');
  }

  const pending = res.body.data.pendingToken as string;
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

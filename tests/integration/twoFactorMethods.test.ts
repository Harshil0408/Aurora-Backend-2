import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { resetMailer, setMailer, type SecurityMail } from '../../src/infra/mail/mailer.js';
import { adminIdFor, authHeader, currentTotpCode, enableTotpAuthed } from './authFlow.js';
import {
  closeTestDatabase,
  createTestAdmin,
  ensureTestDatabase,
  truncateTestTables,
} from './helpers.js';

const EMAIL = 'admin@local.test';
const PASSWORD = 'Correct-123!';

let outbox: SecurityMail[];

beforeAll(async () => {
  await ensureTestDatabase();
}, 120_000);

beforeEach(async () => {
  await truncateTestTables();
  await createTestAdmin({ email: EMAIL, password: PASSWORD, status: 'ACTIVE' });
  outbox = [];
  setMailer({ send: async (mail: SecurityMail) => void outbox.push(mail) });
});

afterEach(() => {
  resetMailer();
});

afterAll(async () => {
  await closeTestDatabase();
});

function lastCode(): string {
  const mail = outbox[outbox.length - 1];
  if (!mail) throw new Error('no mail captured');
  const match = /(\d{6})/.exec(mail.text);
  if (!match?.[1]) throw new Error(`no OTP code in mail: ${mail.text}`);
  return match[1];
}

async function directLogin(app: ReturnType<typeof createApp>): Promise<{
  accessToken: string;
  refreshCookie: string;
}> {
  const res = await request(app).post('/api/v1/admin/auth/login').send({
    email: EMAIL,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  expect(res.body.data.requires2fa).toBe(false);
  const raw = res.headers['set-cookie'] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith('admin_rt='))?.split(';')[0] as string;
  return { accessToken: res.body.data.accessToken as string, refreshCookie: cookie };
}

async function enableEmailOtp(app: ReturnType<typeof createApp>, token: string): Promise<void> {
  const req = await request(app)
    .post('/api/v1/admin/auth/2fa/email/request')
    .set(authHeader(token))
    .send({});
  expect(req.status).toBe(200);
  expect(outbox).toHaveLength(1);
  const confirm = await request(app)
    .post('/api/v1/admin/auth/2fa/email/confirm')
    .set(authHeader(token))
    .send({ code: lastCode() });
  expect(confirm.status).toBe(200);
  const admin = await getPrisma().adminUser.findFirstOrThrow();
  expect(admin.emailOtpEnabled).toBe(true);
}

describe('GET /api/v1/admin/auth/me', () => {
  it('returns profile with roles, 2FA flags, and permissions', async () => {
    const app = createApp();
    const { accessToken } = await directLogin(app);
    const res = await request(app).get('/api/v1/admin/auth/me').set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: EMAIL,
      status: 'ACTIVE',
      twoFactor: { totpEnabled: false, emailOtpEnabled: false },
      roles: [],
    });
    expect(typeof res.body.data.id).toBe('string');
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
  });

  it('rejects missing/invalid tokens with 401', async () => {
    const app = createApp();
    expect((await request(app).get('/api/v1/admin/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/auth/me').set(authHeader('bogus'))).status).toBe(
      401,
    );
  });
});

describe('email-OTP two-factor method', () => {
  it('enable → login challenge (channel email_otp) → verify → session', async () => {
    const app = createApp();
    const { accessToken } = await directLogin(app);
    await enableEmailOtp(app, accessToken);

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ requires2fa: true, channel: 'email_otp' });
    expect(typeof login.body.data.pendingToken).toBe('string');
    expect(login.body.data).not.toHaveProperty('accessToken');
    expect(outbox.length).toBeGreaterThanOrEqual(2); // enable code + login code

    const verify = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: login.body.data.pendingToken, code: lastCode() });
    expect(verify.status).toBe(200);
    expect(verify.body.data.method).toBe('email_otp');
    expect(typeof verify.body.data.accessToken).toBe('string');

    // Code is single-use.
    const replay = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: login.body.data.pendingToken, code: lastCode() });
    expect(replay.status).toBe(401);
  });

  it('wrong code fails; resend issues a working code', async () => {
    const app = createApp();
    const { accessToken } = await directLogin(app);
    await enableEmailOtp(app, accessToken);

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    const pending = login.body.data.pendingToken as string;

    const wrong = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: pending, code: '000000' });
    expect(wrong.status).toBe(401);

    const resend = await request(app)
      .post('/api/v1/admin/auth/2fa/email/resend')
      .send({ pendingToken: pending });
    expect(resend.status).toBe(200);

    const verify = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: pending, code: lastCode() });
    expect(verify.status).toBe(200);
  });

  it('TOTP wins when both methods are enabled', async () => {
    const app = createApp();
    const { accessToken } = await directLogin(app);
    await enableEmailOtp(app, accessToken);
    await enableTotpAuthed(app, accessToken, await adminIdFor(EMAIL));

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.body.data).toMatchObject({ requires2fa: true, channel: 'totp' });

    const verify = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({
        pendingToken: login.body.data.pendingToken,
        code: await currentTotpCode(await adminIdFor(EMAIL)),
      });
    expect(verify.status).toBe(200);
    expect(verify.body.data.method).toBe('totp');
  });

  it('disable (password + fresh code) kills sessions, login goes direct again', async () => {
    const app = createApp();
    const before = await directLogin(app);
    await enableEmailOtp(app, before.accessToken);

    // Fresh code for the disable confirmation.
    await request(app)
      .post('/api/v1/admin/auth/2fa/email/request')
      .set(authHeader(before.accessToken))
      .send({});
    const disabled = await request(app)
      .post('/api/v1/admin/auth/2fa/email/disable')
      .set(authHeader(before.accessToken))
      .send({ password: PASSWORD, code: lastCode() });
    expect(disabled.status).toBe(200);

    // Old session is dead (global logout on disable).
    const dead = await request(app)
      .get('/api/v1/admin/auth/me')
      .set(authHeader(before.accessToken));
    expect(dead.status).toBe(401);

    const admin = await getPrisma().adminUser.findFirstOrThrow();
    expect(admin.emailOtpEnabled).toBe(false);

    // Back to direct login.
    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.body.data.requires2fa).toBe(false);
  });

  it('disable rejects wrong password and wrong code', async () => {
    const app = createApp();
    const { accessToken } = await directLogin(app);
    await enableEmailOtp(app, accessToken);

    await request(app)
      .post('/api/v1/admin/auth/2fa/email/request')
      .set(authHeader(accessToken))
      .send({});
    const wrongPass = await request(app)
      .post('/api/v1/admin/auth/2fa/email/disable')
      .set(authHeader(accessToken))
      .send({ password: 'Wrong-999!', code: lastCode() });
    expect(wrongPass.status).toBe(401);

    const wrongCode = await request(app)
      .post('/api/v1/admin/auth/2fa/email/disable')
      .set(authHeader(accessToken))
      .send({ password: PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(401);

    const admin = await getPrisma().adminUser.findFirstOrThrow();
    expect(admin.emailOtpEnabled).toBe(true);
  });
});

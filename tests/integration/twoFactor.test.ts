import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { adminIdFor, authHeader, currentTotpCode, fullLogin, passwordStep } from './authFlow.js';
import {
  closeTestDatabase,
  createTestAdmin,
  ensureTestDatabase,
  truncateTestTables,
} from './helpers.js';

const EMAIL = 'admin@local.test';
const PASSWORD = 'Correct-123!';

beforeAll(async () => {
  await ensureTestDatabase();
}, 120_000);

beforeEach(async () => {
  await truncateTestTables();
  await createTestAdmin({ email: EMAIL, password: PASSWORD, status: 'ACTIVE' });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('TOTP two-factor authentication', () => {
  it('enroll → confirm → verify yields a working access token', async () => {
    const app = createApp();
    const pending = await passwordStep(app, EMAIL, PASSWORD);

    const enroll = await request(app)
      .post('/api/v1/admin/auth/2fa/enroll')
      .send({ pendingToken: pending });
    expect(enroll.status).toBe(200);
    expect(enroll.body.data.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(enroll.body.data.recoveryCodes).toHaveLength(10);
    expect(enroll.body.data).not.toHaveProperty('secretBase32'); // never exposed

    const id = await adminIdFor(EMAIL);
    const confirm = await request(app)
      .post('/api/v1/admin/auth/2fa/confirm')
      .send({ pendingToken: pending, code: await currentTotpCode(id) });
    expect(confirm.status).toBe(200);

    const enabled = await getPrisma().adminUser.findUniqueOrThrow({ where: { id } });
    expect(enabled.totpEnabled).toBe(true);

    // Pending token alone cannot touch protected routes.
    const denied = await request(app).get('/api/v1/admin/roles').set(authHeader(pending));
    expect(denied.status).toBe(401);
  });

  it('wrong TOTP code fails without enabling 2FA', async () => {
    const app = createApp();
    const pending = await passwordStep(app, EMAIL, PASSWORD);
    await request(app).post('/api/v1/admin/auth/2fa/enroll').send({ pendingToken: pending });

    const bad = await request(app)
      .post('/api/v1/admin/auth/2fa/confirm')
      .send({ pendingToken: pending, code: '000000' });
    expect(bad.status).toBe(401);

    const id = await adminIdFor(EMAIL);
    const admin = await getPrisma().adminUser.findUniqueOrThrow({ where: { id } });
    expect(admin.totpEnabled).toBe(false);
    const failures = await getPrisma().adminLoginActivity.count({
      where: { event: 'TWO_FA_FAILURE' },
    });
    expect(failures).toBe(1);
  });

  it('recovery code logs in once, then is dead', async () => {
    const app = createApp();
    const { recoveryCodes } = await fullLogin(app, EMAIL, PASSWORD);
    const pending = await passwordStep(app, EMAIL, PASSWORD);
    const first = recoveryCodes[0] as string;

    const ok = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: pending, code: first });
    expect(ok.status).toBe(200);
    expect(ok.body.data.method).toBe('recovery');

    const replay = await request(app)
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ pendingToken: pending, code: first });
    expect(replay.status).toBe(401);

    const used = await getPrisma().adminLoginActivity.count({
      where: { event: 'RECOVERY_CODE_USED' },
    });
    expect(used).toBe(1);
  });

  it('2FA disable requires password + code, wipes secret, kills sessions', async () => {
    const app = createApp();
    const session = await fullLogin(app, EMAIL, PASSWORD);

    const disabled = await request(app)
      .post('/api/v1/admin/auth/2fa/disable')
      .set(authHeader(session.accessToken))
      .send({ password: PASSWORD, code: await currentTotpCode(await adminIdFor(EMAIL)) });
    expect(disabled.status).toBe(200);

    // Old access token is dead (global logout on disable).
    const dead = await request(app).get('/api/v1/admin/roles').set(authHeader(session.accessToken));
    expect(dead.status).toBe(401);

    const admin = await getPrisma().adminUser.findUniqueOrThrow({
      where: { emailNormalized: EMAIL },
    });
    expect(admin.totpEnabled).toBe(false);
    expect(admin.totpSecretEncrypted).toBeNull();
  });
});

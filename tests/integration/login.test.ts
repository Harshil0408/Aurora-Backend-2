import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { verifyAccessToken, verifyPendingToken } from '../../src/modules/auth/crypto/tokens.js';
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

describe('POST /api/v1/admin/auth/login', () => {
  it('valid credentials return a 2FA-pending token (never a session)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { requires2fa: true } });
    expect(typeof res.body.data.pendingToken).toBe('string');
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');

    // Pending token verifies as pending…
    const pending = verifyPendingToken(res.body.data.pendingToken as string);
    expect(pending.valid).toBe(true);

    // …but is NOT a usable access token (no session before 2FA).
    expect(verifyAccessToken(res.body.data.pendingToken as string)).toEqual({
      valid: false,
      reason: 'invalid',
    });
  });

  it('email matching is case-insensitive', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'ADMIN@LOCAL.TEST', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('wrong password and unknown email give the IDENTICAL generic 401', async () => {
    const app = createApp();
    const wrong = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: 'Wrong-999!' });
    const unknown = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong-999!' });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }
    // Identical except requestId (unique per request by design).
    const { requestId: _a, ...wrongRest } = wrong.body.error as Record<string, unknown>;
    const { requestId: _b, ...unknownRest } = unknown.body.error as Record<string, unknown>;
    expect(wrongRest).toEqual(unknownRest);

    const failures = await getPrisma().adminLoginActivity.count({
      where: { event: 'LOGIN_FAILURE' },
    });
    expect(failures).toBe(2);
  });

  it('locks the account after 5 failures; correct password still 401 while locked', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/admin/auth/login')
        .send({ email: EMAIL, password: 'Wrong-999!' });
      expect(res.status).toBe(401);
    }

    const admin = await getPrisma().adminUser.findFirstOrThrow();
    expect(admin.failedLoginAttempts).toBe(5);
    expect(admin.lockedUntil).not.toBeNull();

    const lockedEvents = await getPrisma().adminLoginActivity.count({
      where: { event: 'ACCOUNT_LOCKED' },
    });
    expect(lockedEvents).toBe(1);

    const res = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('suspended and disabled accounts cannot log in (generic 401, status event logged)', async () => {
    await createTestAdmin({ email: 's@x.com', password: PASSWORD, status: 'SUSPENDED' });
    await createTestAdmin({ email: 'd@x.com', password: PASSWORD, status: 'DISABLED' });
    const app = createApp();

    for (const email of ['s@x.com', 'd@x.com']) {
      const res = await request(app)
        .post('/api/v1/admin/auth/login')
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }
    const blocked = await getPrisma().adminLoginActivity.count({
      where: { event: 'LOGIN_BLOCKED_STATUS' },
    });
    expect(blocked).toBe(2);
  });

  it('successful login resets failure counters and records request metadata', async () => {
    const app = createApp();
    await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: 'Wrong-999!' });
    const ok = await request(app)
      .post('/api/v1/admin/auth/login')
      .set('User-Agent', 'stage2-test')
      .send({ email: EMAIL, password: PASSWORD });
    expect(ok.status).toBe(200);

    const admin = await getPrisma().adminUser.findFirstOrThrow();
    expect(admin.failedLoginAttempts).toBe(0);

    const success = await getPrisma().adminLoginActivity.findFirstOrThrow({
      where: { event: 'LOGIN_SUCCESS' },
    });
    expect(success.outcome).toBe('SUCCESS');
    expect(success.adminId).toBe(admin.id);
    expect(typeof success.requestId).toBe('string');
  });

  it('rejects malformed payloads with 400', async () => {
    const app = createApp();
    const cases = [
      {},
      { email: EMAIL },
      { password: PASSWORD },
      { email: 'not-an-email', password: PASSWORD },
      { email: EMAIL, password: '' },
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/v1/admin/auth/login').send(body);
      expect(res.status).toBe(400);
    }
  });
});

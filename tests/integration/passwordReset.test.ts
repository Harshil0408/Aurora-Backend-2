import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { setMailer, type SecurityMail } from '../../src/infra/mail/mailer.js';
import { authHeader, fullLogin, passwordStep } from './authFlow.js';
import {
  closeTestDatabase,
  createTestAdmin,
  ensureTestDatabase,
  truncateTestTables,
} from './helpers.js';

const EMAIL = 'admin@local.test';
const PW = 'Correct-123!';
const NEW_PW = 'Brand-New-Pass-456!';

let outbox: SecurityMail[];

beforeAll(async () => {
  await ensureTestDatabase();
}, 120_000);

beforeEach(async () => {
  await truncateTestTables();
  await createTestAdmin({ email: EMAIL, password: PW });
  outbox = [];
  setMailer({ send: async (mail: SecurityMail) => void outbox.push(mail) });
});

afterEach(() => {
  setMailer(undefined); // restore LogMailer
});

afterAll(async () => {
  await closeTestDatabase();
});

function extractToken(mail: SecurityMail): string {
  const match = /: (\S+)\s*$/.exec(mail.text);
  if (!match?.[1]) throw new Error('no token in captured mail');
  return match[1];
}

describe('password reset & change', () => {
  it('unknown email gets generic 200 and no mail (no enumeration)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/admin/auth/forgot-password')
      .send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(outbox).toHaveLength(0);
  });

  it('full reset: mail → reset → new password works, token single-use, sessions die', async () => {
    const app = createApp();
    const before = await fullLogin(app, EMAIL, PW);

    await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: EMAIL });
    expect(outbox).toHaveLength(1);

    const reset = await request(app)
      .post('/api/v1/admin/auth/reset-password')
      .send({ token: extractToken(outbox[0] as SecurityMail), newPassword: NEW_PW });
    expect(reset.status).toBe(200);

    // New password logs in; old one does not.
    expect(await passwordStep(app, EMAIL, NEW_PW)).toBeTruthy();
    const stale = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password: PW });
    expect(stale.status).toBe(401);

    // Token reuse rejected.
    const reuse = await request(app)
      .post('/api/v1/admin/auth/reset-password')
      .send({ token: extractToken(outbox[0] as SecurityMail), newPassword: 'Another-Pass-789!' });
    expect(reuse.status).toBe(400);

    // Pre-reset session is dead (global revocation on reset).
    const dead = await request(app)
      .get('/api/v1/admin/auth/sessions')
      .set(authHeader(before.accessToken));
    expect(dead.status).toBe(401);

    const events = await getPrisma().adminLoginActivity.findMany({
      where: { event: { in: ['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED'] } },
    });
    expect(events).toHaveLength(2);
  });

  it('rejects recently used passwords', async () => {
    const app = createApp();
    await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: EMAIL });
    const token = extractToken(outbox[0] as SecurityMail);
    const res = await request(app)
      .post('/api/v1/admin/auth/reset-password')
      .send({ token, newPassword: PW });
    expect(res.status).toBe(400);
  });

  it('change password: wrong current rejected; right one kills sessions', async () => {
    const app = createApp();
    const session = await fullLogin(app, EMAIL, PW);

    const wrong = await request(app)
      .post('/api/v1/admin/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'Nope-12345678!', newPassword: NEW_PW });
    expect(wrong.status).toBe(401);

    const changed = await request(app)
      .post('/api/v1/admin/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: PW, newPassword: NEW_PW });
    expect(changed.status).toBe(200);

    // Current session died with the change.
    const dead = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(dead.status).toBe(401);

    expect(await passwordStep(app, EMAIL, NEW_PW)).toBeTruthy();
    const changed_event = await getPrisma().adminLoginActivity.count({
      where: { event: 'PASSWORD_CHANGED' },
    });
    expect(changed_event).toBe(1);
  });
});

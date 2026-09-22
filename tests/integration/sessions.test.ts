import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { authHeader, fullLogin } from './authFlow.js';
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

describe('sessions & refresh rotation', () => {
  it('refresh rotates: new tokens work, old refresh reuse kills the family', async () => {
    const app = createApp();
    const session = await fullLogin(app, EMAIL, PASSWORD);

    const rotated = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).not.toBe(session.accessToken);
    const freshCookie = (rotated.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('admin_rt='),
    );
    expect(freshCookie).toBeDefined();

    // Reuse of the rotated (dead) token = theft → whole family revoked.
    const replay = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(replay.status).toBe(401);

    // Even the newest token from that family is now dead.
    const afterTheft = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', (freshCookie as string).split(';')[0] as string);
    expect(afterTheft.status).toBe(401);
  });

  it('logout kills current access + refresh; logout-all kills everything', async () => {
    const app = createApp();
    const session = await fullLogin(app, EMAIL, PASSWORD);

    const out = await request(app)
      .post('/api/v1/admin/auth/logout')
      .set(authHeader(session.accessToken));
    expect(out.status).toBe(200);

    const deadAccess = await request(app)
      .get('/api/v1/admin/auth/sessions')
      .set(authHeader(session.accessToken));
    expect(deadAccess.status).toBe(401);
    const deadRefresh = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(deadRefresh.status).toBe(401);

    // Second device still alive → logout-all finishes it.
    const second = await fullLogin(app, EMAIL, PASSWORD);
    const all = await request(app)
      .post('/api/v1/admin/auth/logout-all')
      .set(authHeader(second.accessToken));
    expect(all.status).toBe(200);
    const gone = await request(app)
      .get('/api/v1/admin/auth/sessions')
      .set(authHeader(second.accessToken));
    expect(gone.status).toBe(401); // tokenVersion bump kills JWTs
  });

  it('lists sessions with current flag and revokes another session', async () => {
    const app = createApp();
    const first = await fullLogin(app, EMAIL, PASSWORD);
    const second = await fullLogin(app, EMAIL, PASSWORD);

    const list = await request(app)
      .get('/api/v1/admin/auth/sessions')
      .set(authHeader(second.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = (list.body.data as { id: string; current: boolean }[]).find((s) => !s.current);
    const revoke = await request(app)
      .delete(`/api/v1/admin/auth/sessions/${other?.id}`)
      .set(authHeader(second.accessToken));
    expect(revoke.status).toBe(200);

    // First device's tokens are now dead.
    const deadRefresh = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', first.refreshCookie);
    expect(deadRefresh.status).toBe(401);

    const remaining = await getPrisma().adminSession.count({ where: { revokedAt: null } });
    expect(remaining).toBe(1);
  });
});

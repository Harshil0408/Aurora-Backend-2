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

const SUPER = 'super@x.com';
const VIEWER = 'viewer@x.com';
const PW = 'Correct-123!';

async function seedMinimal(): Promise<void> {
  const prisma = getPrisma();
  await prisma.adminRole.create({
    data: { key: 'super_admin', name: 'Super Admin', isSystem: true },
  });
  for (const key of ['admin.read', 'audit.read']) {
    const dot = key.indexOf('.');
    await prisma.permission.create({
      data: { key, module: key.slice(0, dot), action: key.slice(dot + 1) },
    });
  }
}

async function grantRole(email: string, roleKey: string): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { emailNormalized: email.toLowerCase() },
  });
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.adminRoleAssignment.create({ data: { adminId: admin.id, roleId: role.id } });
}

beforeAll(async () => {
  await ensureTestDatabase();
}, 120_000);

beforeEach(async () => {
  await truncateTestTables();
  await seedMinimal();
  await createTestAdmin({ email: SUPER, password: PW });
  await grantRole(SUPER, 'super_admin');
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('Activity feed', () => {
  it('lists snapshot entries newest-first with derived diffs', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const created = await request(app)
      .post('/api/v1/admin/roles')
      .set(authHeader(session.accessToken))
      .send({ key: 'analyst', name: 'Analyst' });
    expect(created.status).toBe(201);

    const replaced = await request(app)
      .put('/api/v1/admin/roles/analyst/permissions')
      .set(authHeader(session.accessToken))
      .send({ permissionKeys: ['admin.read'] });
    expect(replaced.status).toBe(200);

    const list = await request(app)
      .get('/api/v1/admin/activity')
      .set(authHeader(session.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(2);
    // Newest first: the PUT row sorts above the create row.
    expect(list.body.data[0]).toMatchObject({
      action: 'role.permissions_updated',
      actionLabel: 'Role updated',
      category: 'Roles',
    });
    expect(list.body.data[0].actor).toMatchObject({ email: SUPER });
    expect(list.body.data[0].resource).toMatchObject({
      type: 'role',
      id: 'analyst',
      label: 'Analyst',
    });
    expect(list.body.data[0].changes).toEqual([
      { field: 'permissions', before: 'admin.read, audit.read', after: 'admin.read' },
    ]);
    expect(list.body.data[1]).toMatchObject({ action: 'role.created' });
    expect(list.body.data[1].changes).toEqual([
      { field: 'key', before: '—', after: 'analyst' },
      { field: 'name', before: '—', after: 'Analyst' },
      { field: 'permissions', before: '—', after: 'admin.read, audit.read' },
    ]);
    expect(typeof list.body.data[0].timestamp).toBe('string');
    expect(typeof list.body.data[0].requestId).toBe('string');
  });

  it('snapshots survive later renames (no read-time JOIN)', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    const prisma = getPrisma();
    const admin = await prisma.adminUser.findUniqueOrThrow({
      where: { emailNormalized: SUPER },
    });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { name: 'Super One' } });
    await request(app)
      .post('/api/v1/admin/roles')
      .set(authHeader(session.accessToken))
      .send({ key: 'analyst', name: 'Analyst' });

    // Rename the actor and the role AFTER the event was recorded.
    await prisma.adminUser.update({ where: { id: admin.id }, data: { name: 'Renamed' } });
    await prisma.adminRole.update({ where: { key: 'analyst' }, data: { name: 'Renamed Role' } });

    const list = await request(app)
      .get('/api/v1/admin/activity?action=role.created')
      .set(authHeader(session.accessToken));
    expect(list.body.data[0].actor).toMatchObject({ email: SUPER, name: 'Super One' });
    expect(list.body.data[0].resource).toMatchObject({ id: 'analyst', label: 'Analyst' });
  });

  it('filters by action, q, actor, dates, and sort', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    await request(app)
      .post('/api/v1/admin/roles')
      .set(authHeader(session.accessToken))
      .send({ key: 'analyst', name: 'Analyst' });

    const today = new Date().toISOString().slice(0, 10) as string;
    const byAction = await request(app)
      .get('/api/v1/admin/activity?action=role.created')
      .set(authHeader(session.accessToken));
    expect(byAction.body.pagination.total).toBe(1);

    const multi = await request(app)
      .get('/api/v1/admin/activity?action=role.created&action=role.deleted')
      .set(authHeader(session.accessToken));
    expect(multi.body.pagination.total).toBe(1);

    const unknown = await request(app)
      .get('/api/v1/admin/activity?action=nope.unknown')
      .set(authHeader(session.accessToken));
    expect(unknown.status).toBe(200);
    expect(unknown.body.pagination.total).toBe(0);

    const byQ = await request(app)
      .get('/api/v1/admin/activity?q=analyst')
      .set(authHeader(session.accessToken));
    expect(byQ.body.pagination.total).toBe(1);

    const byActor = await request(app)
      .get(`/api/v1/admin/activity?actor=${SUPER}`)
      .set(authHeader(session.accessToken));
    expect(byActor.body.pagination.total).toBe(1);

    const byDate = await request(app)
      .get(`/api/v1/admin/activity?from=${today}&to=${today}`)
      .set(authHeader(session.accessToken));
    expect(byDate.body.pagination.total).toBe(1);

    const oldest = await request(app)
      .get('/api/v1/admin/activity?sort=oldest')
      .set(authHeader(session.accessToken));
    expect(oldest.body.data[0]).toMatchObject({ action: 'role.created' });

    const badSort = await request(app)
      .get('/api/v1/admin/activity?sort=bogus')
      .set(authHeader(session.accessToken));
    expect(badSort.status).toBe(400);

    const clamped = await request(app)
      .get('/api/v1/admin/activity?limit=1000')
      .set(authHeader(session.accessToken));
    expect(clamped.status).toBe(200);
    expect(clamped.body.pagination).toMatchObject({ limit: 100, total: 1 });

    const badDate = await request(app)
      .get('/api/v1/admin/activity?from=not-a-date')
      .set(authHeader(session.accessToken));
    expect(badDate.status).toBe(400);

    const flipped = await request(app)
      .get('/api/v1/admin/activity?from=2026-02-01&to=2026-01-01')
      .set(authHeader(session.accessToken));
    expect(flipped.status).toBe(400);
  });

  it('serves filter options with counts, entry detail, and guards', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    await request(app)
      .post('/api/v1/admin/roles')
      .set(authHeader(session.accessToken))
      .send({ key: 'analyst', name: 'Analyst' });

    const actions = await request(app)
      .get('/api/v1/admin/activity/actions')
      .set(authHeader(session.accessToken));
    expect(actions.status).toBe(200);
    expect(actions.body.data).toEqual([
      { action: 'role.created', label: 'Role created', category: 'Roles', count: 1 },
    ]);

    const list = await request(app)
      .get('/api/v1/admin/activity')
      .set(authHeader(session.accessToken));
    const id = list.body.data[0].id as string;
    const detail = await request(app)
      .get(`/api/v1/admin/activity/${id}`)
      .set(authHeader(session.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id, action: 'role.created' });

    const missing = await request(app)
      .get('/api/v1/admin/activity/does-not-exist')
      .set(authHeader(session.accessToken));
    expect(missing.status).toBe(404);

    // Admin without audit.read gets 403 on all three endpoints.
    await getPrisma().adminRole.create({ data: { key: 'viewer', name: 'Viewer' } });
    await createTestAdmin({ email: VIEWER, password: PW });
    await grantRole(VIEWER, 'viewer');
    const viewer = await fullLogin(app, VIEWER, PW);
    for (const path of ['/api/v1/admin/activity', '/api/v1/admin/activity/actions']) {
      const denied = await request(app).get(path).set(authHeader(viewer.accessToken));
      expect(denied.status).toBe(403);
    }
    const deniedDetail = await request(app)
      .get(`/api/v1/admin/activity/${id}`)
      .set(authHeader(viewer.accessToken));
    expect(deniedDetail.status).toBe(403);
  });

  it('labels legacy role.update rows by payload', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    const prisma = getPrisma();
    const admin = await prisma.adminUser.findUniqueOrThrow({
      where: { emailNormalized: SUPER },
    });
    await prisma.adminAuditLog.create({
      data: {
        actorId: admin.id,
        actorEmail: SUPER,
        action: 'role.update',
        resourceType: 'role',
        resourceId: 'legacy',
        resourceLabel: 'Legacy',
        after: { permissions: ['admin.read'] },
      },
    });

    const list = await request(app)
      .get('/api/v1/admin/activity?action=role.permissions_updated')
      .set(authHeader(session.accessToken));
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ action: 'role.permissions_updated' });
  });
});

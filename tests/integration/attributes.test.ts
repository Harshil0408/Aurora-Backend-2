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
const PW = 'Correct-123!';

async function seedMinimal(): Promise<void> {
  const prisma = getPrisma();
  await prisma.adminRole.create({
    data: { key: 'super_admin', name: 'Super Admin', isSystem: true },
  });
  for (const key of [
    'admin.read',
    'audit.read',
    'attribute.read',
    'attribute.create',
    'attribute.update',
    'attribute.delete',
  ]) {
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

describe('Global attributes', () => {
  it('CRUD by type: create → list filtered → update → status → delete', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    const auth = authHeader(session.accessToken);

    const cat = await request(app).post('/api/v1/admin/attributes').set(auth).send({
      type: 'category',
      key: 'fashion',
      label: 'Fashion',
      sortOrder: 1,
    });
    expect(cat.status).toBe(201);
    expect(cat.body.data).toMatchObject({ type: 'category', key: 'fashion', status: 'ACTIVE' });

    const lang = await request(app).post('/api/v1/admin/attributes').set(auth).send({
      type: 'language',
      key: 'en',
      label: 'English',
      value: 'en-US',
    });
    expect(lang.status).toBe(201);

    // Same key allowed under a different type.
    const catEn = await request(app).post('/api/v1/admin/attributes').set(auth).send({
      type: 'category',
      key: 'en',
      label: 'English Books',
    });
    expect(catEn.status).toBe(201);

    // Duplicate [type,key] rejected.
    const dup = await request(app).post('/api/v1/admin/attributes').set(auth).send({
      type: 'category',
      key: 'fashion',
      label: 'Fashion Again',
    });
    expect(dup.status).toBe(409);

    // Type-filtered list returns only that type.
    const list = await request(app).get('/api/v1/admin/attributes?type=category').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(2);
    expect(list.body.data.map((r: { key: string }) => r.key).sort()).toEqual(['en', 'fashion']);

    // Types endpoint backs the per-type frontend screens.
    const types = await request(app).get('/api/v1/admin/attributes/types').set(auth);
    expect(types.body.data).toEqual([
      { type: 'category', count: 2 },
      { type: 'language', count: 1 },
    ]);

    // Update label; type/key are immutable (no such fields accepted).
    const updated = await request(app)
      .patch(`/api/v1/admin/attributes/${cat.body.data.id as string}`)
      .set(auth)
      .send({ label: 'Fashion & Apparel' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.label).toBe('Fashion & Apparel');

    const status = await request(app)
      .patch(`/api/v1/admin/attributes/${cat.body.data.id as string}/status`)
      .set(auth)
      .send({ status: 'INACTIVE', reason: 'Seasonal cleanup' });
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('INACTIVE');

    // INACTIVE rows are excluded when filtering by status.
    const active = await request(app)
      .get('/api/v1/admin/attributes?type=category&status=ACTIVE')
      .set(auth);
    expect(active.body.pagination.total).toBe(1);

    const deleted = await request(app)
      .delete(`/api/v1/admin/attributes/${cat.body.data.id as string}`)
      .set(auth);
    expect(deleted.status).toBe(200);

    const gone = await request(app)
      .get(`/api/v1/admin/attributes/${cat.body.data.id as string}`)
      .set(auth);
    expect(gone.status).toBe(404);
  });

  it('rejects reads without the attribute permission', async () => {
    const app = createApp();
    const prisma = getPrisma();
    await prisma.adminRole.create({ data: { key: 'support', name: 'Support' } });
    await createTestAdmin({ email: 'viewer@x.com', password: PW });
    await grantRole('viewer@x.com', 'support');
    const session = await fullLogin(app, 'viewer@x.com', PW);

    const res = await request(app)
      .get('/api/v1/admin/attributes?type=category')
      .set(authHeader(session.accessToken));
    expect(res.status).toBe(403);
  });
});

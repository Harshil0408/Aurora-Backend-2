import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import {
  PERMISSION_SEEDS,
  ROLE_SEEDS,
  SUPER_ADMIN_ROLE_KEY,
} from '../../src/modules/rbac/permissions.js';
import { STORE_PERMISSION_SEEDS } from '../../src/modules/seller-panel/team/store-permissions.js';
import { authHeader, fullLogin } from './authFlow.js';
import {
  closeTestDatabase,
  createTestAdmin,
  ensureTestDatabase,
  truncateTestTables,
} from './helpers.js';

const ADMIN = 'cat-admin@local.test';
const PW = 'Correct-123!';

/** Full catalog seed: admin RBAC (super gets all) + store permissions + plan. */
async function seedCatalog(): Promise<void> {
  const prisma = getPrisma();
  for (const seed of PERMISSION_SEEDS) {
    await prisma.permission.upsert({
      where: { key: seed.key },
      update: {},
      create: {
        key: seed.key,
        module: seed.module,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: seed.isSystem,
      },
    });
  }
  for (const role of ROLE_SEEDS) {
    await prisma.adminRole.upsert({
      where: { key: role.key },
      update: {},
      create: { key: role.key, name: role.name, description: role.description, isSystem: true },
    });
  }
  const superRole = await prisma.adminRole.findUniqueOrThrow({
    where: { key: SUPER_ADMIN_ROLE_KEY },
  });
  const perms = await prisma.permission.findMany({ select: { id: true } });
  for (const p of perms) {
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: superRole.id, permissionId: p.id } },
      update: {},
      create: { roleId: superRole.id, permissionId: p.id },
    });
  }
  for (const seed of STORE_PERMISSION_SEEDS) {
    await prisma.storePermission.upsert({
      where: { key: seed.key },
      update: {},
      create: {
        key: seed.key,
        resource: seed.resource,
        action: seed.action,
        label: seed.label,
        description: seed.description,
        isSystem: true,
      },
    });
  }
  await prisma.subscriptionPlan.upsert({
    where: { key: 'starter' },
    update: {},
    create: {
      key: 'starter',
      name: 'Starter',
      description: 'Trial plan',
      pricePaise: 49900,
      billingCycle: 'MONTHLY',
      trialDays: 14,
      isActive: true,
    },
  });
}

async function adminLogin(app: Express): Promise<string> {
  await createTestAdmin({ email: ADMIN, password: PW });
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { emailNormalized: ADMIN.toLowerCase() },
  });
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { key: SUPER_ADMIN_ROLE_KEY } });
  await prisma.adminRoleAssignment.create({ data: { adminId: admin.id, roleId: role.id } });
  const session = await fullLogin(app, ADMIN, PW);
  return session.accessToken;
}

async function registerSeller(app: Express, email: string) {
  const res = await request(app)
    .post('/api/v1/seller/auth/register')
    .send({ email, password: 'Strong-Password-123', name: email.split('@')[0] });
  expect(res.status).toBe(201);
  return { accessToken: res.body.data.accessToken as string };
}

async function createStore(app: Express, token: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/seller/stores')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

let app: Express;

beforeAll(async () => {
  await ensureTestDatabase();
  app = createApp();
});

beforeEach(async () => {
  await truncateTestTables();
  await seedCatalog();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('admin category tree', () => {
  it('create → nested tree with breadcrumbs + leaf flags', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const fashion = await request(app).post('/api/v1/admin/categories').set(auth).send({ name: 'Fashion' });
    expect(fashion.status).toBe(201);
    expect(fashion.body.data.slug).toBe('fashion');

    const men = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Men', parentId: fashion.body.data.id, displayOrder: 1 });
    expect(men.status).toBe(201);

    const kurtas = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Kurtas', slug: 'mens-kurtas', parentId: men.body.data.id });
    expect(kurtas.status).toBe(201);
    expect(kurtas.body.data.slug).toBe('mens-kurtas');

    const tree = await request(app).get('/api/v1/admin/categories/tree').set(auth);
    expect(tree.status).toBe(200);
    expect(tree.body.data).toHaveLength(1);
    const root = tree.body.data[0];
    expect(root.leaf).toBe(false);
    const leaf = root.children[0].children[0];
    expect(leaf.leaf).toBe(true);
    expect(leaf.breadcrumb).toBe('Fashion / Men / Kurtas');
  });

  it('rename retires the old slug as a redirect and reserves it', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const created = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Sarees' });
    const id = created.body.data.id as string;

    const renamed = await request(app)
      .patch(`/api/v1/admin/categories/${id}`)
      .set(auth)
      .send({ name: 'Designer Sarees' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.slug).toBe('designer-sarees');

    const prisma = getPrisma();
    const redir = await prisma.categoryRedirect.findUnique({ where: { slug: 'sarees' } });
    expect(redir?.categoryId).toBe(id);

    // Retired slug is reserved: reusing it mints a suffixed slug instead.
    const reuse = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Sarees' });
    expect(reuse.status).toBe(201);
    expect(reuse.body.data.slug).toBe('sarees-2');
  });

  it('rejects cycles and blocks delete with children (reassign moves them)', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const a = (await request(app).post('/api/v1/admin/categories').set(auth).send({ name: 'Aaa' })).body.data;
    const b = (
      await request(app).post('/api/v1/admin/categories').set(auth).send({ name: 'Bbb', parentId: a.id })
    ).body.data;

    const cycle = await request(app)
      .patch(`/api/v1/admin/categories/${a.id}`)
      .set(auth)
      .send({ parentId: b.id });
    expect(cycle.status).toBe(400);

    const blocked = await request(app)
      .delete(`/api/v1/admin/categories/${a.id}`)
      .set(auth)
      .send({ reason: 'cleanup' });
    expect(blocked.status).toBe(409);

    const c = (await request(app).post('/api/v1/admin/categories').set(auth).send({ name: 'Ccc' })).body.data;
    const moved = await request(app)
      .delete(`/api/v1/admin/categories/${a.id}`)
      .set(auth)
      .send({ reason: 'merge into Ccc', reassignTo: c.id });
    expect(moved.status).toBe(200);

    const child = await request(app).get(`/api/v1/admin/categories/${b.id}`).set(auth);
    expect(child.body.data.parentId).toBe(c.id);
  });

  it('deactivation hides the branch from the seller tree', async () => {
    const adminToken = await adminLogin(app);
    const auth = authHeader(adminToken);
    const created = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Hidden Gems' });
    const id = created.body.data.id as string;
    const off = await request(app)
      .patch(`/api/v1/admin/categories/${id}/status`)
      .set(auth)
      .send({ status: 'INACTIVE', reason: 'seasonal pause' });
    expect(off.status).toBe(200);

    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const storeId = await createStore(app, accessToken, 'Tree Store');
    const tree = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/tree`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(tree.status).toBe(200);
    expect(tree.body.data).toEqual([]);
  });

  it('import validates before commit and reports row errors', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const preview = await request(app)
      .post('/api/v1/admin/categories/import')
      .set(auth)
      .send({
        mode: 'validate',
        rows: [
          { name: 'Electronics' },
          { name: 'Mobiles', parentPath: 'electronics' },
          { name: 'X' },
          { name: 'Ghost', parentPath: 'nope' },
        ],
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.creates).toBe(2);
    expect(preview.body.data.committed).toBe(false);
    expect(preview.body.data.errors).toHaveLength(2);

    const commit = await request(app)
      .post('/api/v1/admin/categories/import')
      .set(auth)
      .send({ mode: 'commit', rows: [{ name: 'Electronics' }, { name: 'Mobiles', parentPath: 'electronics' }] });
    expect(commit.status).toBe(200);
    expect(commit.body.data.committed).toBe(true);

    const exported = await request(app).get('/api/v1/admin/categories/export').set(auth);
    expect(exported.status).toBe(200);
    expect(exported.body.data.map((r: { slug: string }) => r.slug).sort()).toEqual([
      'electronics',
      'mobiles',
    ]);
  });
});

describe('platform asset uploads', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('uploads category artwork and serves it publicly', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const upload = await request(app)
      .post('/api/v1/admin/uploads')
      .set(auth)
      .field('folder', 'categories')
      .attach('file', PNG, { filename: 'banner.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    expect(upload.body.data.url).toContain('/uploads/platform/categories/');

    const served = await request(app).get(upload.body.data.url as string);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');

    const prisma = getPrisma();
    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: 'platform.asset_uploaded' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects non-image platform artwork', async () => {
    const token = await adminLogin(app);
    const bad = await request(app)
      .post('/api/v1/admin/uploads')
      .set(authHeader(token))
      .attach('file', Buffer.from('MZ fake'), {
        filename: 'evil.exe',
        contentType: 'application/x-msdownload',
      });
    expect(bad.status).toBe(400);
  });
});

describe('seller requests + restricted access', () => {
  it('request → approve links the resolved category; access grants gate restricted nodes', async () => {
    const adminToken = await adminLogin(app);
    const adminAuth = authHeader(adminToken);

    const pharma = (
      await request(app).post('/api/v1/admin/categories').set(adminAuth).send({ name: 'Pharmacy', restricted: true })
    ).body.data;

    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const sellerAuth = { Authorization: `Bearer ${accessToken}` };
    const storeId = await createStore(app, accessToken, 'Care Store');

    // Restricted with no grant → `restricted`.
    let tree = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/tree`)
      .set(sellerAuth);
    expect(tree.body.data[0].access).toBe('restricted');

    // New-category request + admin approval linking the real node.
    const req = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/categories/requests`)
      .set(sellerAuth)
      .send({ name: 'Ayurveda', justification: 'Fast-growing demand in our region' });
    expect(req.status).toBe(201);

    const queue = await request(app).get('/api/v1/admin/categories/requests').set(adminAuth);
    expect(queue.body.data).toHaveLength(1);

    const ayur = (
      await request(app).post('/api/v1/admin/categories').set(adminAuth).send({ name: 'Ayurveda' })
    ).body.data;
    const approveReq = await request(app)
      .patch(`/api/v1/admin/categories/requests/${req.body.data.id}`)
      .set(adminAuth)
      .send({ decision: 'APPROVED', resolvedCategoryId: ayur.id });
    expect(approveReq.status).toBe(200);

    const mine = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/requests`)
      .set(sellerAuth);
    expect(mine.body.data[0].status).toBe('APPROVED');

    // Restricted access: upload a PDF proof, apply, approve → `granted`.
    const pdf = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(sellerAuth)
      .attach('files', Buffer.from('%PDF-1.4 licence'), {
        filename: 'drug-licence.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.status).toBe(201);
    const docId = pdf.body.data[0].id as string;

    const apply = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/categories/${pharma.id}/access`)
      .set(sellerAuth)
      .send({ documentAssetIds: [docId] });
    expect(apply.status).toBe(201);

    const dup = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/categories/${pharma.id}/access`)
      .set(sellerAuth)
      .send({ documentAssetIds: [docId] });
    expect(dup.status).toBe(409);

    tree = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/tree`)
      .set(sellerAuth);
    expect(tree.body.data.find((n: { id: string }) => n.id === pharma.id).access).toBe('pending');

    const grants = await request(app).get('/api/v1/admin/categories/access').set(adminAuth);
    const grantApprove = await request(app)
      .patch(`/api/v1/admin/categories/access/${grants.body.data[0].id}`)
      .set(adminAuth)
      .send({ decision: 'APPROVED' });
    expect(grantApprove.status).toBe(200);

    tree = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/tree`)
      .set(sellerAuth);
    expect(tree.body.data.find((n: { id: string }) => n.id === pharma.id).access).toBe('granted');
  });

  it('enforces the tenant boundary on category routes', async () => {
    await adminLogin(app);
    const owner = await registerSeller(app, 'owner@shop.test');
    const intruder = await registerSeller(app, 'intruder@shop.test');
    const storeId = await createStore(app, owner.accessToken, 'Care Store');

    const cross = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/tree`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);
    expect(cross.status).toBe(403);
  });
});

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

const ADMIN = 'brand-admin@local.test';
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

describe('admin brand CRUD + slug lifecycle', () => {
  it('create → rename retires the old slug and reserves it', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const created = await request(app)
      .post('/api/v1/admin/brands')
      .set(auth)
      .send({ name: 'Acme', website: 'https://acme.test', country: 'IN' });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe('acme');

    const renamed = await request(app)
      .patch(`/api/v1/admin/brands/${created.body.data.id}`)
      .set(auth)
      .send({ name: 'Acme Industries' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.slug).toBe('acme-industries');

    const prisma = getPrisma();
    const redir = await prisma.brandRedirect.findUnique({ where: { slug: 'acme' } });
    expect(redir?.brandId).toBe(created.body.data.id);

    // Retired slug is reserved: reusing it mints a suffixed slug instead.
    const reuse = await request(app).post('/api/v1/admin/brands').set(auth).send({ name: 'Acme' });
    expect(reuse.status).toBe(201);
    expect(reuse.body.data.slug).toBe('acme-2');

    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'brand.updated' } });
    expect(audit).not.toBeNull();
  });

  it('deactivation hides the brand from the seller list', async () => {
    const adminToken = await adminLogin(app);
    const auth = authHeader(adminToken);
    const created = (
      await request(app).post('/api/v1/admin/brands').set(auth).send({ name: 'Hidden Co' })
    ).body.data;
    const off = await request(app)
      .patch(`/api/v1/admin/brands/${created.id}/status`)
      .set(auth)
      .send({ status: 'INACTIVE', reason: 'brand under dispute' });
    expect(off.status).toBe(200);

    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const storeId = await createStore(app, accessToken, 'Brand Store');
    const list = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/brands`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  it('import validates before commit and reports row errors', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const preview = await request(app)
      .post('/api/v1/admin/brands/import')
      .set(auth)
      .send({
        mode: 'validate',
        rows: [
          { name: 'Nova' },
          { name: 'Nova', slug: 'nova-labs' },
          { name: 'X' },
          { name: 'Dude', slug: 'nova' },
        ],
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.creates).toBe(2);
    expect(preview.body.data.errors).toHaveLength(2);
    expect(preview.body.data.errors.map((e: { row: number }) => e.row).sort()).toEqual([3, 4]);

    const commit = await request(app)
      .post('/api/v1/admin/brands/import')
      .set(auth)
      .send({ mode: 'commit', rows: [{ name: 'Nova' }, { name: 'Nova', slug: 'nova-labs' }] });
    expect(commit.status).toBe(200);
    expect(commit.body.data.committed).toBe(true);

    const exported = await request(app).get('/api/v1/admin/brands/export').set(auth);
    expect(exported.status).toBe(200);
    expect(exported.body.data.map((r: { slug: string }) => r.slug).sort()).toEqual([
      'nova',
      'nova-labs',
    ]);
  });

  it('merge re-points authorisations, retires slugs, and blocks self/merged targets', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const a = (await request(app).post('/api/v1/admin/brands').set(auth).send({ name: 'Zephyr' }))
      .body.data;
    const b = (await request(app).post('/api/v1/admin/brands').set(auth).send({ name: 'Zeph' }))
      .body.data;

    const self = await request(app)
      .post(`/api/v1/admin/brands/${a.id}/merge`)
      .set(auth)
      .send({ targetId: a.id, reason: 'id typo' });
    expect(self.status).toBe(400);

    const prisma = getPrisma();
    // A pre-existing authorisation under the doomed brand moves with it.
    const seller = await prisma.sellerUser.create({
      data: { email: 'merge@shop.test', emailNormalized: 'merge@shop.test', passwordHash: 'x' },
    });
    const store = await prisma.store.create({
      data: { name: 'M', slug: 'm', ownerId: seller.id, status: 'ACTIVE' },
    });
    await prisma.brandAuthorization.create({
      data: { brandId: a.id, storeId: store.id, status: 'APPROVED' },
    });

    const merged = await request(app)
      .post(`/api/v1/admin/brands/${a.id}/merge`)
      .set(auth)
      .send({ targetId: b.id, reason: 'duplicate brand rows' });
    expect(merged.status).toBe(200);

    const movedAuth = await prisma.brandAuthorization.findFirst({ where: { brandId: b.id } });
    expect(movedAuth).not.toBeNull();
    const redir = await prisma.brandRedirect.findUnique({ where: { slug: 'zephyr' } });
    expect(redir?.brandId).toBe(b.id);
    const dead = await prisma.brand.findUnique({ where: { id: a.id } });
    expect(dead?.mergedIntoId).toBe(b.id);
    expect(dead?.deletedAt).not.toBeNull();

    // Re-merge into a merged brand is rejected.
    const intoDead = await request(app)
      .post(`/api/v1/admin/brands/${b.id}/merge`)
      .set(auth)
      .send({ targetId: a.id, reason: 'undo' });
    expect(intoDead.status).toBe(404);
  });
});

describe('seller brand access lifecycle', () => {
  it('request → approve-with-link; restricted brand authorisation gates access states', async () => {
    const adminToken = await adminLogin(app);
    const adminAuth = authHeader(adminToken);

    const lux = (
      await request(app)
        .post('/api/v1/admin/brands')
        .set(adminAuth)
        .send({ name: 'LuxeLine', restricted: true })
    ).body.data;

    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const sellerAuth = { Authorization: `Bearer ${accessToken}` };
    const storeId = await createStore(app, accessToken, 'Gate Store');

    // Restricted with no authorisation → `restricted`.
    let list = await request(app).get(`/api/v1/seller/catalog/${storeId}/brands`).set(sellerAuth);
    expect(list.body.data[0].access).toBe('restricted');

    // Open brand access resolves as `open`; point lookup matches.
    const openBrand = (
      await request(app).post('/api/v1/admin/brands').set(adminAuth).send({ name: 'OpenLine' })
    ).body.data;
    const access = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/brands/${openBrand.id}/access`)
      .set(sellerAuth);
    expect(access.body.data.access).toBe('open');

    // Duplicate-name requests are fast-failed: use the master row instead.
    const dupReq = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/requests`)
      .set(sellerAuth)
      .send({ name: 'OpenLine', justification: 'We thought this was missing' });
    expect(dupReq.status).toBe(409);

    // New-brand request + admin approval linking the real row.
    const req = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/requests`)
      .set(sellerAuth)
      .send({ name: 'Nimbus', justification: 'Vendor authorised us for their craft line' });
    expect(req.status).toBe(201);

    const queue = await request(app)
      .get('/api/v1/admin/brands/requests')
      .set(adminAuth)
      .query({ status: 'PENDING' });
    expect(queue.body.data).toHaveLength(1);

    const nimbus = (
      await request(app).post('/api/v1/admin/brands').set(adminAuth).send({ name: 'Nimbus' })
    ).body.data;
    const approveReq = await request(app)
      .patch(`/api/v1/admin/brands/requests/${req.body.data.id}`)
      .set(adminAuth)
      .send({ decision: 'APPROVED', resolvedBrandId: nimbus.id });
    expect(approveReq.status).toBe(200);

    // Apply for restricted-brand authorisation with a stored PDF proof.
    const pdf = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(sellerAuth)
      .attach('files', Buffer.from('%PDF-1.4 authorisation'), {
        filename: 'luxe-authorisation.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.status).toBe(201);
    const docId = pdf.body.data[0].id as string;

    const apply = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/${lux.id}/authorisations`)
      .set(sellerAuth)
      .send({
        documentAssetIds: [docId],
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      });
    expect(apply.status).toBe(201);

    const dupApply = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/${lux.id}/authorisations`)
      .set(sellerAuth)
      .send({ documentAssetIds: [docId] });
    expect(dupApply.status).toBe(409);

    list = await request(app).get(`/api/v1/seller/catalog/${storeId}/brands`).set(sellerAuth);
    expect(list.body.data.find((b: { id: string }) => b.id === lux.id).access).toBe('pending');

    const grants = await request(app)
      .get('/api/v1/admin/brands/authorisations')
      .set(adminAuth)
      .query({ status: 'PENDING' });
    const approve = await request(app)
      .patch(`/api/v1/admin/brands/authorisations/${grants.body.data[0].id}`)
      .set(adminAuth)
      .send({ decision: 'APPROVED' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.expiresAt).not.toBeNull();

    list = await request(app).get(`/api/v1/seller/catalog/${storeId}/brands`).set(sellerAuth);
    expect(list.body.data.find((b: { id: string }) => b.id === lux.id).access).toBe('granted');

    // Store audits recorded the seller-side mutations.
    const audit = await getPrisma().storeAuditLog.findMany({
      where: { storeId, action: { in: ['brand.requested', 'brand.access_requested'] } },
    });
    expect(audit).toHaveLength(2);
  });

  it('expired authorisation re-opens applications and reports expired', async () => {
    const token = await adminLogin(app);
    const auth = authHeader(token);

    const lux = (
      await request(app)
        .post('/api/v1/admin/brands')
        .set(auth)
        .send({ name: 'ExpiryLine', restricted: true })
    ).body.data;

    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const sellerAuth = { Authorization: `Bearer ${accessToken}` };
    const storeId = await createStore(app, accessToken, 'Expiry Store');

    const pdf = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(sellerAuth)
      .attach('files', Buffer.from('%PDF-1.4 old'), {
        filename: 'old.pdf',
        contentType: 'application/pdf',
      });
    const docId = pdf.body.data[0].id as string;

    const apply = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/${lux.id}/authorisations`)
      .set(sellerAuth)
      .send({ documentAssetIds: [docId] });
    expect(apply.status).toBe(201);

    const grants = await request(app)
      .get('/api/v1/admin/brands/authorisations')
      .set(auth)
      .query({ status: 'PENDING' });
    // Approve with an already-past expiry → effective access is `expired`.
    const approve = await request(app)
      .patch(`/api/v1/admin/brands/authorisations/${grants.body.data[0].id}`)
      .set(auth)
      .send({ decision: 'APPROVED', expiresAt: new Date(Date.now() - 86400_000).toISOString() });
    expect(approve.status).toBe(200);

    const list = await request(app).get(`/api/v1/seller/catalog/${storeId}/brands`).set(sellerAuth);
    expect(list.body.data[0].access).toBe('expired');

    // Fresh application allowed (approve-but-expired does not block).
    await request(app)
      .patch(`/api/v1/seller/catalog/${storeId}/media/${pdf.body.data[0].id}`)
      .set(sellerAuth)
      .send({ tags: ['reuse'] });
    const reapply = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/brands/${lux.id}/authorisations`)
      .set(sellerAuth)
      .send({ documentAssetIds: [docId] });
    expect(reapply.status).toBe(201);
  });

  it('enforces the tenant boundary on brand routes', async () => {
    await adminLogin(app);
    const owner = await registerSeller(app, 'owner@shop.test');
    const intruder = await registerSeller(app, 'intruder@shop.test');
    const storeId = await createStore(app, owner.accessToken, 'Gate Store');

    const cross = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/brands`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);
    expect(cross.status).toBe(403);
  });
});

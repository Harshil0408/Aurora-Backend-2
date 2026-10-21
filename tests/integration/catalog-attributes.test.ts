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

const ADMIN = 'attr-admin@local.test';
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

describe('product attribute catalog (Module 4)', () => {
  it('creates an attribute with auto code and inline options; duplicate code conflicts', async () => {
    const token = await adminLogin(app);
    const res = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({
        name: 'RAM Size',
        type: 'DROPDOWN',
        filterable: true,
        options: [
          { label: '8 GB', value: '8gb', displayOrder: 1 },
          { label: '16 GB', value: '16gb', displayOrder: 2 },
        ],
      });
    expect(res.status).toBe(201);
    const attribute = res.body.data;
    expect(attribute.code).toBe('ram_size');
    expect(attribute.options).toHaveLength(2);

    const dup = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Different Name', code: 'ram_size', type: 'TEXT' });
    expect(dup.status).toBe(409);

    // Non-option types silently drop inline options.
    const text = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({
        name: 'Serial Note',
        type: 'TEXT',
        options: [{ label: 'X', value: 'x' }],
      });
    expect(text.status).toBe(201);
    expect(text.body.data.options).toHaveLength(0);
  });

  it('updates flags, guards the min/max rule, and soft-deletes set-linked attributes', async () => {
    const token = await adminLogin(app);
    const created = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Screen Size', type: 'DECIMAL', unit: 'inch' });
    const id = created.body.data.id as string;

    const badRange = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/${id}`)
      .set(authHeader(token))
      .send({ validationMin: 10, validationMax: 5 });
    expect(badRange.status).toBe(400);

    const updated = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/${id}`)
      .set(authHeader(token))
      .send({ validationMin: 1, validationMax: 100, required: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data.required).toBe(true);

    // Attach a set → delete must be blocked → detach → delete ok.
    const set = await request(app)
      .post('/api/v1/admin/attribute-sets')
      .set(authHeader(token))
      .send({ name: 'Electronics Set' });
    const setId = set.body.data.id as string;
    const attach = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/items`)
      .set(authHeader(token))
      .send({ attributeId: id });
    expect(attach.status).toBe(201);

    const blocked = await request(app)
      .delete(`/api/v1/admin/catalog-attributes/${id}`)
      .set(authHeader(token));
    expect(blocked.status).toBe(409);

    const item = attach.body.data;
    const detach = await request(app)
      .delete(`/api/v1/admin/attribute-sets/${setId}/items/${item.id}`)
      .set(authHeader(token));
    expect(detach.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/v1/admin/catalog-attributes/${id}`)
      .set(authHeader(token));
    expect(deleted.status).toBe(200);
  });

  it('option lifecycle: unique ACTIVE values, reorder, disable/re-enable, delete', async () => {
    const token = await adminLogin(app);
    const created = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Color', type: 'COLOR_SWATCH' });
    const id = created.body.data.id as string;

    const a = await request(app)
      .post(`/api/v1/admin/catalog-attributes/${id}/options`)
      .set(authHeader(token))
      .send({ label: 'Red', value: 'red', swatchHex: '#FF0000' });
    expect(a.status).toBe(201);

    // COLOR_SWATCH without swatchHex → 400.
    const noSwatch = await request(app)
      .post(`/api/v1/admin/catalog-attributes/${id}/options`)
      .set(authHeader(token))
      .send({ label: 'Blue', value: 'blue' });
    expect(noSwatch.status).toBe(400);

    const b = await request(app)
      .post(`/api/v1/admin/catalog-attributes/${id}/options`)
      .set(authHeader(token))
      .send({ label: 'Blue', value: 'blue', swatchHex: '#0000FF', displayOrder: 1 });
    expect(b.status).toBe(201);

    const dup = await request(app)
      .post(`/api/v1/admin/catalog-attributes/${id}/options`)
      .set(authHeader(token))
      .send({ label: 'Red 2', value: 'red', swatchHex: '#AA0000' });
    expect(dup.status).toBe(409);

    const reorder = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/${id}/options/reorder`)
      .set(authHeader(token))
      .send({
        orders: [
          { id: b.body.data.id, displayOrder: 0 },
          { id: a.body.data.id, displayOrder: 1 },
        ],
      });
    expect(reorder.status).toBe(200);

    const disable = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/${id}/options/${b.body.data.id}`)
      .set(authHeader(token))
      .send({ status: 'DISABLED' });
    expect(disable.status).toBe(200);
    expect(disable.body.data.status).toBe('DISABLED');

    // After disabling, the value is free again for a NEW option.
    const freed = await request(app)
      .post(`/api/v1/admin/catalog-attributes/${id}/options`)
      .set(authHeader(token))
      .send({ label: 'Blue Lite', value: 'blue', swatchHex: '#0000AA' });
    expect(freed.status).toBe(201);

    const del = await request(app)
      .delete(`/api/v1/admin/catalog-attributes/${id}/options/${b.body.data.id}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);
  });

  it('seller suggestion queue: create, duplicate guards, approve and reject', async () => {
    const token = await adminLogin(app);
    const created = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Storage', type: 'DROPDOWN' });
    const attrId = created.body.data.id as string;

    const owner = await registerSeller(app, 'suggester@shop.test');
    const storeId = await createStore(app, owner.accessToken, 'Suggest Store');

    const suggest = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/attributes/${attrId}/options`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ value: '1tb' });
    expect(suggest.status).toBe(201);
    expect(suggest.body.data.status).toBe('SUGGESTED');
    expect(suggest.body.data.suggestedByStoreId).toBe(storeId);

    const pendingDup = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/attributes/${attrId}/options`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ value: '1tb' });
    expect(pendingDup.status).toBe(409);

    const queue = await request(app)
      .get('/api/v1/admin/catalog-attributes/suggestions')
      .set(authHeader(token));
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    const optionId = queue.body.data[0].id as string;

    const approved = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/options/${optionId}/review`)
      .set(authHeader(token))
      .send({ decision: 'APPROVED' });
    expect(approved.status).toBe(200);

    // Now the value is ACTIVE → further suggestions conflict.
    const activeDup = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/attributes/${attrId}/options`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ value: '1tb' });
    expect(activeDup.status).toBe(409);

    const second = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/attributes/${attrId}/options`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ value: '512gb' });
    expect(second.status).toBe(201);
    const secondId = second.body.data.id as string;

    const rejected = await request(app)
      .patch(`/api/v1/admin/catalog-attributes/options/${secondId}/review`)
      .set(authHeader(token))
      .send({ decision: 'REJECTED', reviewNote: 'Not a marketable size' });
    expect(rejected.status).toBe(200);
    const after = await getPrisma().productAttributeOption.findUnique({ where: { id: secondId } });
    expect(after).toBeNull();
  });
});

describe('attribute sets (Module 4)', () => {
  it('CRUD + rename reslug + clone deep-copies groups and items as INACTIVE', async () => {
    const token = await adminLogin(app);
    const attr = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Material', type: 'DROPDOWN' });
    const attrId = attr.body.data.id as string;

    const set = await request(app)
      .post('/api/v1/admin/attribute-sets')
      .set(authHeader(token))
      .send({ name: 'Fashion Base' });
    expect(set.status).toBe(201);
    const setId = set.body.data.id as string;
    expect(set.body.data.slug).toBe('fashion-base');

    const group = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/groups`)
      .set(authHeader(token))
      .send({ name: 'Specifications', displayOrder: 1 });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;

    const groupDup = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/groups`)
      .set(authHeader(token))
      .send({ name: 'Specifications' });
    expect(groupDup.status).toBe(409);

    const attach = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/items`)
      .set(authHeader(token))
      .send({ attributeId: attrId, groupId, required: true });
    expect(attach.status).toBe(201);
    const itemId = attach.body.data.id as string;

    const dupAttach = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/items`)
      .set(authHeader(token))
      .send({ attributeId: attrId });
    expect(dupAttach.status).toBe(409);

    const clone = await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/clone`)
      .set(authHeader(token))
      .send({});
    expect(clone.status).toBe(201);
    expect(clone.body.data.slug).toBe('fashion-base-copy');
    expect(clone.body.data.status).toBe('INACTIVE');

    const cloneDetail = await request(app)
      .get(`/api/v1/admin/attribute-sets/${clone.body.data.id}`)
      .set(authHeader(token));
    expect(cloneDetail.body.data.items).toHaveLength(1);
    expect(cloneDetail.body.data.groups).toHaveLength(1);
    expect(cloneDetail.body.data.groups[0].name).toBe('Specifications');

    const rename = await request(app)
      .patch(`/api/v1/admin/attribute-sets/${setId}`)
      .set(authHeader(token))
      .send({ name: 'Fashion Pro' });
    expect(rename.status).toBe(200);
    expect(rename.body.data.slug).toBe('fashion-pro');

    // Delete blocked while item attached → detach → delete works.
    await request(app)
      .delete(`/api/v1/admin/attribute-sets/${setId}/items/${itemId}`)
      .set(authHeader(token));
    const del = await request(app)
      .delete(`/api/v1/admin/attribute-sets/${setId}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);
  });

  it('set assignment flows through category attach → set delete blocked → unassign → delete', async () => {
    const token = await adminLogin(app);
    const cat = await request(app)
      .post('/api/v1/admin/categories')
      .set(authHeader(token))
      .send({ name: 'Chairs' });
    expect(cat.status).toBe(201);
    const categoryId = cat.body.data.id as string;

    const set = await request(app)
      .post('/api/v1/admin/attribute-sets')
      .set(authHeader(token))
      .send({ name: 'Furniture' });
    const setId = set.body.data.id as string;

    const assign = await request(app)
      .patch(`/api/v1/admin/categories/${categoryId}`)
      .set(authHeader(token))
      .send({ attributeSetId: setId });
    expect(assign.status).toBe(200);
    expect(assign.body.data.attributeSetId).toBe(setId);

    const blocked = await request(app)
      .delete(`/api/v1/admin/attribute-sets/${setId}`)
      .set(authHeader(token));
    expect(blocked.status).toBe(409);

    const unassign = await request(app)
      .patch(`/api/v1/admin/categories/${categoryId}`)
      .set(authHeader(token))
      .send({ attributeSetId: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.attributeSetId).toBeNull();

    const del = await request(app)
      .delete(`/api/v1/admin/attribute-sets/${setId}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);
  });

  it('seller resolves own vs inherited attribute sets and 403s cross-store reads', async () => {
    const token = await adminLogin(app);
    const attr = await request(app)
      .post('/api/v1/admin/catalog-attributes')
      .set(authHeader(token))
      .send({ name: 'Fabric', type: 'DROPDOWN' });
    const attrId = attr.body.data.id as string;

    const parentCat = await request(app)
      .post('/api/v1/admin/categories')
      .set(authHeader(token))
      .send({ name: 'Apparel' });
    const childCat = await request(app)
      .post('/api/v1/admin/categories')
      .set(authHeader(token))
      .send({ name: 'Shirts', parentId: parentCat.body.data.id });

    const set = await request(app)
      .post('/api/v1/admin/attribute-sets')
      .set(authHeader(token))
      .send({ name: 'Apparel Set' });
    const setId = set.body.data.id as string;
    await request(app)
      .post(`/api/v1/admin/attribute-sets/${setId}/items`)
      .set(authHeader(token))
      .send({ attributeId: attrId });
    await request(app)
      .patch(`/api/v1/admin/categories/${parentCat.body.data.id}`)
      .set(authHeader(token))
      .send({ attributeSetId: setId });

    const seller = await registerSeller(app, 'resolver@shop.test');
    const storeId = await createStore(app, seller.accessToken, 'Resolve Store');

    const own = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/${childCat.body.data.id}/attribute-set`)
      .set('Authorization', `Bearer ${seller.accessToken}`);
    expect(own.status).toBe(200);
    expect(own.body.data.resolvedFrom).toBe('inherited');
    expect(own.body.data.set.id).toBe(setId);
    expect(own.body.data.set.items[0].attribute.options).toEqual([]);

    const none = await request(app)
      .post('/api/v1/admin/categories')
      .set(authHeader(token))
      .send({ name: 'Unrelated' });
    const unblessed = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/${none.body.data.id}/attribute-set`)
      .set('Authorization', `Bearer ${seller.accessToken}`);
    expect(unblessed.status).toBe(200);
    expect(unblessed.body.data.set).toBeNull();

    const intruder = await registerSeller(app, 'cross-attrs@shop.test');
    const cross = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/categories/${childCat.body.data.id}/attribute-set`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);
    expect(cross.status).toBe(403);
  });
});

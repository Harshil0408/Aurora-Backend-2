import { promises as fs } from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { STORE_PERMISSION_SEEDS } from '../../src/modules/seller-panel/team/store-permissions.js';
import { adjustUsage } from '../../src/modules/seller-panel/catalog/media/media.service.js';
import { closeTestDatabase, ensureTestDatabase, truncateTestTables } from './helpers.js';

// 1x1 PNG — smallest valid image payload for upload tests.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function seedSellerCatalog(): Promise<void> {
  const prisma = getPrisma();
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
    update: { limits: { 'storage.mb': 1024 } as never },
    create: {
      key: 'starter',
      name: 'Starter',
      description: 'Trial plan',
      pricePaise: 49900,
      billingCycle: 'MONTHLY',
      trialDays: 14,
      isActive: true,
      limits: { 'storage.mb': 1024 } as never,
    },
  });
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
  await seedSellerCatalog();
  await fs.rm(path.resolve(process.cwd(), 'uploads-test'), { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(path.resolve(process.cwd(), 'uploads-test'), { recursive: true, force: true });
  await closeTestDatabase();
});

describe('catalog media library', () => {
  it('upload → list → quota → update → delete', async () => {
    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const storeId = await createStore(app, accessToken, 'Media Store');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const upload = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(auth)
      .field('folder', 'products')
      .field('altText', 'Red kurta front')
      .attach('files', PNG, { filename: 'kurta.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    const asset = upload.body.data[0] as { id: string; url: string; kind: string };
    expect(asset.kind).toBe('IMAGE');
    expect(asset.url).toContain('/uploads/stores/');

    // The public URL must actually resolve through the static mount
    // (regression: scope prefix `public/` leaked into the URL → 404).
    const served = await request(app).get(asset.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');

    // Dedup: same bytes again returns the same asset with deduped=true.
    const reupload = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(auth)
      .attach('files', PNG, { filename: 'kurta-copy.png', contentType: 'image/png' });
    expect(reupload.status).toBe(201);
    expect(reupload.body.data[0].id).toBe(asset.id);
    expect(reupload.body.data[0].deduped).toBe(true);

    const list = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/media?search=kurta&kind=IMAGE`)
      .set(auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);

    const quota = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/media/quota`)
      .set(auth);
    expect(quota.status).toBe(200);
    expect(quota.body.data.usedBytes).toBeGreaterThan(0);
    expect(quota.body.data.assetCount).toBe(1);

    const patch = await request(app)
      .patch(`/api/v1/seller/catalog/${storeId}/media/${asset.id}`)
      .set(auth)
      .send({ caption: 'Festive red kurta', tags: ['festive', 'kurta'] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.caption).toBe('Festive red kurta');

    // Audit trail recorded the upload + update.
    const prisma = getPrisma();
    const audits = await prisma.storeAuditLog.findMany({
      where: { storeId, resourceType: 'media', resourceId: asset.id },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(['media.update', 'media.upload']);

    const del = await request(app)
      .delete(`/api/v1/seller/catalog/${storeId}/media/${asset.id}`)
      .set(auth);
    expect(del.status).toBe(200);
  });

  it('blocks delete while the asset is in use', async () => {
    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const storeId = await createStore(app, accessToken, 'Media Store');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const upload = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(auth)
      .attach('files', PNG, { filename: 'saree.png', contentType: 'image/png' });
    const id = upload.body.data[0].id as string;

    await adjustUsage(storeId, [id], 1);
    const blocked = await request(app)
      .delete(`/api/v1/seller/catalog/${storeId}/media/${id}`)
      .set(auth);
    expect(blocked.status).toBe(409);

    await adjustUsage(storeId, [id], -1);
    const freed = await request(app)
      .delete(`/api/v1/seller/catalog/${storeId}/media/${id}`)
      .set(auth);
    expect(freed.status).toBe(200);
  });

  it('rejects unsupported types and enforces the tenant boundary', async () => {
    const owner = await registerSeller(app, 'owner@shop.test');
    const intruder = await registerSeller(app, 'intruder@shop.test');
    const storeId = await createStore(app, owner.accessToken, 'Media Store');

    const bad = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .attach('files', Buffer.from('MZ fake exe'), {
        filename: 'evil.exe',
        contentType: 'application/x-msdownload',
      });
    expect(bad.status).toBe(400);

    const cross = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/media`)
      .set({ Authorization: `Bearer ${intruder.accessToken}` });
    expect(cross.status).toBe(403);
  });

  it('stores documents privately (no public URL)', async () => {
    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const storeId = await createStore(app, accessToken, 'Media Store');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const upload = await request(app)
      .post(`/api/v1/seller/catalog/${storeId}/media`)
      .set(auth)
      .field('visibility', 'PUBLIC')
      .attach('files', Buffer.from('%PDF-1.4 fake'), {
        filename: 'gst.pdf',
        contentType: 'application/pdf',
      });
    expect(upload.status).toBe(201);
    expect(upload.body.data[0].kind).toBe('DOCUMENT');
    expect(upload.body.data[0].visibility).toBe('PRIVATE');
    expect(upload.body.data[0].url).toBeNull();

    const id = upload.body.data[0].id as string;
    const file = await request(app)
      .get(`/api/v1/seller/catalog/${storeId}/media/${id}/file`)
      .set(auth);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
  });
});

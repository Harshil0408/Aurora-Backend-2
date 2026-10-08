import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import { STORE_PERMISSION_SEEDS } from '../../src/modules/seller-panel/team/store-permissions.js';
import { closeTestDatabase, ensureTestDatabase, truncateTestTables } from './helpers.js';

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

async function registerSeller(
  app: Express,
  email: string,
  password = 'Strong-Password-123',
): Promise<{ accessToken: string; cookie: string; userId: string }> {
  const res = await request(app)
    .post('/api/v1/seller/auth/register')
    .send({ email, password, name: email.split('@')[0] });
  expect(res.status).toBe(201);
  const cookie = (res.headers['set-cookie'] as string[])[0]?.split(';')[0] ?? '';
  return {
    accessToken: res.body.data.accessToken as string,
    cookie,
    userId: res.body.data.user.id as string,
  };
}

let app: Express;

beforeAll(async () => {
  await ensureTestDatabase();
  app = createApp();
});

beforeEach(async () => {
  await truncateTestTables();
  await seedSellerCatalog();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('seller foundation flow', () => {
  it('register → login → me (no stores yet)', async () => {
    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const me = await request(app)
      .get('/api/v1/seller/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('owner@shop.test');
    expect(me.body.data.stores).toEqual([]);
  });

  it('create store bootstraps roles + owner membership + trial subscription', async () => {
    const { accessToken } = await registerSeller(app, 'owner@shop.test');
    const created = await request(app)
      .post('/api/v1/seller/stores')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Aurora Fashion' });
    expect(created.status).toBe(201);
    const storeId = created.body.data.id as string;

    const prisma = getPrisma();
    const roles = await prisma.storeRole.findMany({ where: { storeId } });
    expect(roles.map((r) => r.key).sort()).toEqual(['admin', 'owner', 'staff']);
    const membership = await prisma.storeMembership.findUnique({
      where: { storeId_userId: { storeId, userId: created.body.data.ownerId as string } },
      include: { role: true },
    });
    expect(membership?.role.key).toBe('owner');
    const sub = await prisma.storeSubscription.findFirst({
      where: { storeId },
      include: { plan: true },
    });
    expect(sub?.status).toBe('TRIALING');
    expect(sub?.plan.key).toBe('starter');

    // Owner bypass: full permission set cached for the store.
    const switched = await request(app)
      .post('/api/v1/seller/stores/switch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storeId });
    expect(switched.status).toBe(200);
    expect(switched.body.data.permissions).toContain('store:delete');
  });

  it('enforces the tenant boundary: no cross-store access', async () => {
    const owner = await registerSeller(app, 'owner@shop.test');
    const intruder = await registerSeller(app, 'intruder@shop.test');
    const created = await request(app)
      .post('/api/v1/seller/stores')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Aurora Fashion' });
    const storeId = created.body.data.id as string;

    const denied = await request(app)
      .get(`/api/v1/seller/stores/${storeId}`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);
    expect(denied.status).toBe(403);

    const switchDenied = await request(app)
      .post('/api/v1/seller/stores/switch')
      .set('Authorization', `Bearer ${intruder.accessToken}`)
      .send({ storeId });
    expect(switchDenied.status).toBe(403);
  });

  it('invite → accept → staff read-only → promote → audit trail', async () => {
    const owner = await registerSeller(app, 'owner@shop.test');
    const staff = await registerSeller(app, 'staff@shop.test');
    const created = await request(app)
      .post('/api/v1/seller/stores')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Aurora Fashion' });
    const storeId = created.body.data.id as string;

    // Staff cannot act before joining.
    const preJoin = await request(app)
      .get(`/api/v1/seller/stores/${storeId}`)
      .set('Authorization', `Bearer ${staff.accessToken}`);
    expect(preJoin.status).toBe(403);

    const invite = await request(app)
      .post(`/api/v1/seller/team/${storeId}/invitations`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'staff@shop.test', roleKey: 'staff' });
    expect(invite.status).toBe(201);
    const token = invite.body.data.token as string;

    const accept = await request(app)
      .post('/api/v1/seller/team/invitations/accept')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ token });
    expect(accept.status).toBe(200);

    // Staff can read the store…
    const read = await request(app)
      .get(`/api/v1/seller/stores/${storeId}`)
      .set('Authorization', `Bearer ${staff.accessToken}`);
    expect(read.status).toBe(200);

    // …but cannot manage roles.
    const forbiddenRole = await request(app)
      .post(`/api/v1/seller/team/${storeId}/roles`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ key: 'support-2', name: 'Support 2' });
    expect(forbiddenRole.status).toBe(403);

    // Owner promotes to admin; admin can then create roles.
    const promote = await request(app)
      .patch(`/api/v1/seller/team/${storeId}/members/${staff.userId}/role`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ roleKey: 'admin' });
    expect(promote.status).toBe(200);

    const createRole = await request(app)
      .post(`/api/v1/seller/team/${storeId}/roles`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ key: 'support-2', name: 'Support 2', permissionKeys: ['order:read'] });
    expect(createRole.status).toBe(201);

    // Audit trail captured the lifecycle.
    const audit = await request(app)
      .get(`/api/v1/seller/activity/${storeId}/audit`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(audit.status).toBe(200);
    const actions = (audit.body.data as { action: string }[]).map((e) => e.action);
    expect(actions).toContain('store.created');
    expect(actions).toContain('staff.invited');
    expect(actions).toContain('staff.joined');
  });

  it('plans + subscription + refresh session rotation', async () => {
    const { accessToken, cookie } = await registerSeller(app, 'owner@shop.test');
    const plans = await request(app)
      .get('/api/v1/seller/billing/plans')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(plans.status).toBe(200);
    expect(plans.body.data.length).toBeGreaterThanOrEqual(1);

    const created = await request(app)
      .post('/api/v1/seller/stores')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Aurora Fashion' });
    const storeId = created.body.data.id as string;

    const sub = await request(app)
      .get(`/api/v1/seller/billing/${storeId}/subscription`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sub.status).toBe(200);
    expect(sub.body.data.status).toBe('TRIALING');

    const refreshed = await request(app).post('/api/v1/seller/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  it('invitation inbox: pending list → decline → accept-after-decline fails', async () => {
    const owner = await registerSeller(app, 'owner@shop.test');
    const invited = await registerSeller(app, 'invited@shop.test');
    const stranger = await registerSeller(app, 'stranger@shop.test');
    const created = await request(app)
      .post('/api/v1/seller/stores')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Aurora Fashion' });
    const storeId = created.body.data.id as string;

    const invite = await request(app)
      .post(`/api/v1/seller/team/${storeId}/invitations`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'invited@shop.test', roleKey: 'staff' });
    expect(invite.status).toBe(201);
    const invitationId = invite.body.data.invitationId as string;

    // Invitee sees it without any token link; others see nothing.
    const inbox = await request(app)
      .get('/api/v1/seller/team/invitations/pending')
      .set('Authorization', `Bearer ${invited.accessToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({
      id: invitationId,
      storeId,
      storeName: 'Aurora Fashion',
      roleKey: 'staff',
    });

    const strangerInbox = await request(app)
      .get('/api/v1/seller/team/invitations/pending')
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(strangerInbox.body.data).toEqual([]);

    // Wrong email cannot decline.
    const wrongDecline = await request(app)
      .post(`/api/v1/seller/team/invitations/${invitationId}/decline`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(wrongDecline.status).toBe(403);

    // Invitee declines → inbox empties → token accept now fails.
    const decline = await request(app)
      .post(`/api/v1/seller/team/invitations/${invitationId}/decline`)
      .set('Authorization', `Bearer ${invited.accessToken}`);
    expect(decline.status).toBe(200);

    const inboxAfter = await request(app)
      .get('/api/v1/seller/team/invitations/pending')
      .set('Authorization', `Bearer ${invited.accessToken}`);
    expect(inboxAfter.body.data).toEqual([]);

    const acceptAfterDecline = await request(app)
      .post('/api/v1/seller/team/invitations/accept')
      .set('Authorization', `Bearer ${invited.accessToken}`)
      .send({ token: invite.body.data.token as string });
    expect(acceptAfterDecline.status).toBe(400);
  });
});

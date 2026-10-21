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
import { authHeader, fullLogin } from './authFlow.js';
import {
  closeTestDatabase,
  createTestAdmin,
  ensureTestDatabase,
  truncateTestTables,
} from './helpers.js';

const ADMIN = 'tax-admin@local.test';
const PW = 'Correct-123!';

/** Full catalog seed: admin RBAC (super gets all) + plan row. */
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

let app: Express;
let token: string;

beforeAll(async () => {
  await ensureTestDatabase();
  app = createApp();
});

beforeEach(async () => {
  await truncateTestTables();
  await seedCatalog();
  await createTestAdmin({ email: ADMIN, password: PW });
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { emailNormalized: ADMIN.toLowerCase() },
  });
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { key: SUPER_ADMIN_ROLE_KEY } });
  await prisma.adminRoleAssignment.create({ data: { adminId: admin.id, roleId: role.id } });
  const session = await fullLogin(app, ADMIN, PW);
  token = session.accessToken;
});

afterAll(async () => {
  await closeTestDatabase();
});

/** Verb-bound supertest helpers that pre-attach the admin auth header. */
const authed = () => ({
  get: (url: string) => request(app).get(url).set(authHeader(token)),
  post: (url: string) => request(app).post(url).set(authHeader(token)),
  patch: (url: string) => request(app).patch(url).set(authHeader(token)),
  delete: (url: string) => request(app).delete(url).set(authHeader(token)),
});

async function createClass(name: string): Promise<string> {
  const res = await authed().post('/api/v1/admin/tax-classes').send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function addRate(classId: string, body: Record<string, unknown>): Promise<string> {
  const res = await authed().post(`/api/v1/admin/tax-classes/${classId}/rates`).send(body);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('tax classes and rates (Module 5)', () => {
  it('creates a class, blocks duplicate names, manages ALL + state rate rows', async () => {
    const id = await createClass('GST 18%');
    const dup = await authed().post('/api/v1/admin/tax-classes').send({ name: 'GST 18%' });
    expect(dup.status).toBe(409);

    await addRate(id, { region: 'ALL', ratePercent: 18, cessPercent: 0 });
    await addRate(id, { region: 'KA', ratePercent: 6, cessPercent: 12 });
    const dupRate = await authed()
      .post(`/api/v1/admin/tax-classes/${id}/rates`)
      .send({ region: 'KA', ratePercent: 9 });
    expect(dupRate.status).toBe(409);

    const detail = await authed().get(`/api/v1/admin/tax-classes/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.rates).toHaveLength(2);

    const rates = detail.body.data.rates as Array<{
      id: string;
      region: string;
      ratePercent: number;
    }>;
    const all = rates.find((r) => r.region === 'ALL');
    const ka = rates.find((r) => r.region === 'KA');
    expect(all?.ratePercent).toBe('18');
    expect(ka?.cessPercent).toBe('12');

    const patch = await authed()
      .patch(`/api/v1/admin/tax-classes/${id}/rates/${ka!.id}`)
      .send({ ratePercent: 9, cessPercent: 1 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.ratePercent).toBe('9');

    const removed = await authed().delete(`/api/v1/admin/tax-classes/${id}/rates/${ka!.id}`);
    expect(removed.status).toBe(200);
  });

  it('toggles status and blocks category-default classes from deletion', async () => {
    const id = await createClass('GST 5%');
    await addRate(id, { region: 'ALL', ratePercent: 5, cessPercent: 0 });

    // Link a category while the class is ACTIVE.
    const cat = await authed().post('/api/v1/admin/categories').send({ name: 'Essentials' });
    expect(cat.status).toBe(201);
    const link = await authed()
      .patch(`/api/v1/admin/categories/${cat.body.data.id}`)
      .send({ taxClassId: id });
    expect(link.status).toBe(200);

    const deactivated = await authed()
      .patch(`/api/v1/admin/tax-classes/${id}/status`)
      .send({ status: 'INACTIVE', reason: 'Slab withdrawn' });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.status).toBe('INACTIVE');

    const reactivate = await authed()
      .patch(`/api/v1/admin/tax-classes/${id}/status`)
      .send({ status: 'ACTIVE', reason: 'Slab resumed' });
    expect(reactivate.status).toBe(200);

    const del = await authed().delete(`/api/v1/admin/tax-classes/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('re-point');

    const unassign = await authed()
      .patch(`/api/v1/admin/categories/${cat.body.data.id}`)
      .send({ taxClassId: null });
    expect(unassign.status).toBe(200);
    const delOk = await authed().delete(`/api/v1/admin/tax-classes/${id}`);
    expect(delOk.status).toBe(200);
  });

  it('quotes CGST/SGST intra-state (ALL fallback) and IGST inter-state, KA override wins', async () => {
    const id = await createClass('GST 18%');
    await addRate(id, { region: 'ALL', ratePercent: 18, cessPercent: 0 });
    await addRate(id, { region: 'KA', ratePercent: 6, cessPercent: 3 });

    const intra = await authed().post('/api/v1/admin/tax/quote').send({
      amount: 1000,
      taxClassId: id,
      sellerState: 'KA',
      buyerState: 'KA',
    });
    expect(intra.status).toBe(200);
    expect(
      intra.body.data.components.map((c: { component: string; amount: number }) => c.component),
    ).toEqual(['CGST', 'SGST', 'CESS']);
    // KA override: 6% headline → 3% CGST + 3% SGST on 1000; cess 3%.
    const amounts = intra.body.data.components.map((c: { amount: number }) => c.amount);
    expect(amounts).toEqual([30, 30, 30]);
    expect(intra.body.data.grossAmount).toBe(1090);

    // MH has no override → 'ALL' row: 18% IGST, no cess.
    const inter = await authed().post('/api/v1/admin/tax/quote').send({
      amount: 1000,
      taxClassId: id,
      sellerState: 'KA',
      buyerState: 'MH',
      inclusive: false,
    });
    expect(inter.status).toBe(200);
    expect(inter.body.data.components.map((c: { component: string }) => c.component)).toEqual([
      'IGST',
    ]);
    expect(inter.body.data.taxTotal).toBe(180);
    expect(inter.body.data.grossAmount).toBe(1180);

    const inclusive = await authed().post('/api/v1/admin/tax/quote').send({
      amount: 1180,
      taxClassId: id,
      sellerState: 'KA',
      buyerState: 'MH',
      inclusive: true,
    });
    expect(inclusive.body.data.netAmount).toBe(1000);
    expect(inclusive.body.data.taxTotal).toBe(180);
    expect(inclusive.body.data.grossAmount).toBe(1180);
  });

  it('rejects quotes for unconfigured regions and INACTIVE classes', async () => {
    const noRates = await createClass('GST unconfigured');
    const q1 = await authed()
      .post('/api/v1/admin/tax/quote')
      .send({ amount: 100, taxClassId: noRates, sellerState: 'KA', buyerState: 'MH' });
    expect(q1.status).toBe(400);

    const gated = await createClass('GST gated');
    await addRate(gated, { region: 'ALL', ratePercent: 12, cessPercent: 0 });
    await authed().patch(`/api/v1/admin/tax-classes/${gated}/status`).send({
      status: 'INACTIVE',
      reason: 'Pulled from quoting',
    });
    const q2 = await authed()
      .post('/api/v1/admin/tax/quote')
      .send({ amount: 100, taxClassId: gated, sellerState: 'KA', buyerState: 'MH' });
    expect(q2.status).toBe(400);
  });
});

describe('HSN/SAC master (Module 5)', () => {
  it('validates digit length, blocks duplicate codes, supports edit and delete', async () => {
    const bad = await authed().post('/api/v1/admin/hsn-codes').send({ code: '51039' });
    expect(bad.status).toBe(400);

    const res = await authed()
      .post('/api/v1/admin/hsn-codes')
      .send({ kind: 'HSN', code: '85171300', description: 'Smartphones', gstRatePercent: 18 });
    expect(res.status).toBe(201);

    const sac = await authed().post('/api/v1/admin/hsn-codes').send({ kind: 'SAC', code: '9983' });
    expect(sac.status).toBe(201);

    const dup = await authed().post('/api/v1/admin/hsn-codes').send({ code: '85171300' });
    expect(dup.status).toBe(409);

    const patch = await authed()
      .patch(`/api/v1/admin/hsn-codes/${res.body.data.id}`)
      .send({ gstRatePercent: 28 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.gstRatePercent).toBe('28');

    const del = await authed().delete(`/api/v1/admin/hsn-codes/${sac.body.data.id}`);
    expect(del.status).toBe(200);
  });
});

describe('units of measure (Module 5)', () => {
  it('enforces the one-base-per-dimension rule and same-dimension bases', async () => {
    // Seed MASS base directly via API.
    const kg = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'kg', name: 'Kilogram', dimension: 'MASS', baseCode: 'kg', factor: 1 });
    expect(kg.status).toBe(201);

    const g = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'g', name: 'Gram', dimension: 'MASS', baseCode: 'kg', factor: 0.001 });
    expect(g.status).toBe(201);

    const secondBase = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'lb', name: 'Pound', dimension: 'MASS', baseCode: 'lb', factor: 1 });
    expect(secondBase.status).toBe(400);

    const wrongDimensionBase = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'mm', name: 'Millimetre', dimension: 'MASS', baseCode: 'm', factor: 0.001 });
    expect(wrongDimensionBase.status).toBe(400);

    // Non-base in another dimension is fine once that dimension has a base.
    const m = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'm', name: 'Metre', dimension: 'LENGTH', baseCode: 'm', factor: 1 });
    expect(m.status).toBe(201);
    const okCm = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'cm', name: 'Centimetre', dimension: 'LENGTH', baseCode: 'm', factor: 0.01 });
    expect(okCm.status).toBe(201);
  });

  it('blocks unit deletion while a product attribute allows the code', async () => {
    const kg = await authed()
      .post('/api/v1/admin/units')
      .send({ code: 'kg', name: 'Kilogram', dimension: 'MASS', baseCode: 'kg', factor: 1 });

    await authed()
      .post('/api/v1/admin/catalog-attributes')
      .send({
        name: 'Package weight',
        type: 'DECIMAL',
        unit: 'kg',
        allowedUnits: ['kg'],
      });

    const del = await authed().delete(`/api/v1/admin/units/${kg.body.data.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('allowed-units');
  });
});

describe('commerce settings singleton (Module 5)', () => {
  it('lazily creates defaults, then updates and surfaces them to the quote engine', async () => {
    const initial = await authed().get('/api/v1/admin/commerce-settings');
    expect(initial.status).toBe(200);
    expect(initial.body.data.priceIncludesTax).toBe(false);
    expect(initial.body.data.baseCurrency).toBe('INR');
    expect(initial.body.data.roundingMode).toBe('NONE');

    const update = await authed().patch('/api/v1/admin/commerce-settings').send({
      priceIncludesTax: true,
      roundingMode: 'ROUND_UP_TO_RUPEE',
    });
    expect(update.status).toBe(200);
    expect(update.body.data.priceIncludesTax).toBe(true);
    expect(update.body.data.roundingMode).toBe('ROUND_UP_TO_RUPEE');

    // Quote without explicit flags falls back to settings
    // (priceIncludesTax=true → gross is the sticker; rup rounds tax up).
    const id = await createClass('GST 18%');
    await addRate(id, { region: 'ALL', ratePercent: 18, cessPercent: 0 });
    const q = await authed()
      .post('/api/v1/admin/tax/quote')
      .send({ amount: 999, taxClassId: id, sellerState: 'KA', buyerState: 'MH' });
    expect(q.status).toBe(200);
    // 999 gross → net 846.61 → IGST 152.39 → rup tax 153; net absorbs residual (846).
    expect(q.body.data.grossAmount).toBe(999);
    expect(q.body.data.taxTotal).toBe(153);
    expect(q.body.data.netAmount).toBe(846);
  });
});

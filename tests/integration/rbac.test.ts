import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPrisma } from '../../src/config/db.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
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

const SUPER = 'super@x.com';
const SUB = 'sub@x.com';
const SUPPORT = 'support@x.com';
const PW = 'Correct-123!';

/** Minimal RBAC catalog (mirrors prisma/seed.ts grants). */
async function seedTestRoles(): Promise<void> {
  const prisma = getPrisma();
  for (const role of ROLE_SEEDS) {
    await prisma.adminRole.create({
      data: { key: role.key, name: role.name, description: role.description, isSystem: true },
    });
  }
  const permKeys = new Set<string>();
  for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS))
    for (const p of perms) permKeys.add(p);
  for (const key of permKeys) await prisma.permission.create({ data: { key } });

  const roles = await prisma.adminRole.findMany();
  const perms = await prisma.permission.findMany();
  const permByKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const role of roles) {
    if (role.key === SUPER_ADMIN_ROLE_KEY) continue;
    for (const key of DEFAULT_ROLE_PERMISSIONS[role.key] ?? []) {
      await prisma.adminRolePermission.create({
        data: { roleId: role.id, permissionId: permByKey.get(key) as string },
      });
    }
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
  await seedTestRoles();
  await createTestAdmin({ email: SUPER, password: PW });
  await createTestAdmin({ email: SUB, password: PW });
  await createTestAdmin({ email: SUPPORT, password: PW });
  await grantRole(SUPER, 'super_admin');
  await grantRole(SUB, 'sub_admin');
  await grantRole(SUPPORT, 'support');
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('RBAC + admin management', () => {
  it('support can read admins but cannot create or read audit log', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPPORT, PW);

    const list = await request(app)
      .get('/api/v1/admin/admins')
      .set(authHeader(session.accessToken));
    expect(list.status).toBe(200);

    const create = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({ email: 'new@x.com', password: 'Long-enough-123!', roleKeys: ['support'] });
    expect(create.status).toBe(403);

    const audit = await request(app)
      .get('/api/v1/admin/audit-log')
      .set(authHeader(session.accessToken));
    expect(audit.status).toBe(403);
  });

  it('blocks privilege escalation: non-super cannot grant super_admin', async () => {
    const app = createApp();
    const sub = await fullLogin(app, SUB, PW);

    const escalate = await request(app)
      .put(`/api/v1/admin/admins/${await adminId(SUPPORT)}/roles`)
      .set(authHeader(sub.accessToken))
      .send({ roleKeys: ['super_admin'] });
    expect(escalate.status).toBe(403);

    const create = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(sub.accessToken))
      .send({ email: 'evil@x.com', password: 'Long-enough-123!', roleKeys: ['super_admin'] });
    // sub_admin lacks admin.create entirely
    expect([403, 401]).toContain(create.status);
  });

  it('forbids self-suspension and self super_admin removal', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);
    const id = await adminId(SUPER);

    const suspendSelf = await request(app)
      .patch(`/api/v1/admin/admins/${id}/status`)
      .set(authHeader(session.accessToken))
      .send({ status: 'SUSPENDED', reason: 'self change attempt' });
    expect(suspendSelf.status).toBe(403);
    expect(suspendSelf.body.error.details).toMatchObject({ code: 'CANNOT_CHANGE_OWN_STATUS' });

    const stripSelf = await request(app)
      .put(`/api/v1/admin/admins/${id}/roles`)
      .set(authHeader(session.accessToken))
      .send({ roleKeys: ['sub_admin'] });
    expect(stripSelf.status).toBe(403);
    expect(stripSelf.body.error.details).toMatchObject({ code: 'CANNOT_REMOVE_OWN_SUPER_ADMIN' });
  });

  it('Admins screen: summary, detail, filters, check-email, generate, revoke-sessions', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const summary = await request(app)
      .get('/api/v1/admin/admins/summary')
      .set(authHeader(session.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      total: 3,
      active: 3,
      suspended: 0,
      disabled: 0,
      needsAttention: 0,
    });
    expect(summary.body.data.twoFactorEnabled).toBe(1); // fullLogin enrolls TOTP for SUPER

    const filtered = await request(app)
      .get('/api/v1/admin/admins?search=support@x.com&role=support&sort=email:asc')
      .set(authHeader(session.accessToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.pagination.total).toBe(1);
    expect(filtered.body.meta.counts).toMatchObject({ total: 3, active: 3 });
    const item = filtered.body.data[0];
    expect(item).toMatchObject({ email: SUPPORT });
    expect(item.roles).toEqual([{ key: 'support', name: expect.any(String) }]);
    expect(item.twoFactor).toEqual({ enabled: false, methods: [] });
    expect(item.isSelf).toBe(false);
    expect(item.isLastActiveSuperAdmin).toBe(false);
    expect(item.name).toEqual(expect.any(String));

    const detail = await request(app)
      .get(`/api/v1/admin/admins/${await adminId(SUPPORT)}`)
      .set(authHeader(session.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ email: SUPPORT, activeSessionsCount: 0 });
    expect(Array.isArray(detail.body.data.recentActivity)).toBe(true);

    const checkTaken = await request(app)
      .get(`/api/v1/admin/admins/check-email?email=${SUPPORT}`)
      .set(authHeader(session.accessToken));
    expect(checkTaken.body.data).toEqual({ available: false });
    const checkFree = await request(app)
      .get('/api/v1/admin/admins/check-email?email=free@x.com')
      .set(authHeader(session.accessToken));
    expect(checkFree.body.data).toEqual({ available: true });

    const generated = await request(app)
      .post('/api/v1/admin/admins/password/generate')
      .set(authHeader(session.accessToken));
    expect(generated.status).toBe(200);
    expect(generated.body.data.password.length).toBeGreaterThanOrEqual(12);

    const subSession = await fullLogin(app, SUB, PW);
    const revoke = await request(app)
      .post(`/api/v1/admin/admins/${await adminId(SUB)}/revoke-sessions`)
      .set(authHeader(session.accessToken));
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revokedCount).toBeGreaterThanOrEqual(1);
    // Caller session untouched — still authorized.
    const stillMe = await request(app)
      .get('/api/v1/admin/auth/me')
      .set(authHeader(session.accessToken));
    expect(stillMe.status).toBe(200);
    void subSession;
  });

  it('Admins screen: create with name+tempPassword, status with reason, roles diff', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const created = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({
        email: 'New-Admin@x.com',
        name: 'New Admin',
        tempPassword: 'Temp-Password-123!',
        roleKeys: ['support'],
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      email: 'New-Admin@x.com',
      name: 'New Admin',
      status: 'ACTIVE',
      inviteSent: false,
    });
    const newId: string = created.body.data.id;

    const dup = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({
        email: 'new-admin@x.com',
        tempPassword: 'Temp-Password-123!',
        roleKeys: ['support'],
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toMatchObject({ code: 'EMAIL_IN_USE' });

    const weak = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({ email: 'weak@x.com', tempPassword: 'password123!', roleKeys: ['support'] });
    expect(weak.status).toBe(422);

    const suspended = await request(app)
      .patch(`/api/v1/admin/admins/${newId}/status`)
      .set(authHeader(session.accessToken))
      .send({ status: 'Suspended', reason: 'policy violation' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data).toMatchObject({ id: newId, status: 'SUSPENDED' });

    const audit = await request(app)
      .get(`/api/v1/admin/audit-log?action=admin.suspend&resourceType=admin&resourceId=${newId}`)
      .set(authHeader(session.accessToken));
    expect(audit.body.data[0]).toMatchObject({
      after: { status: 'SUSPENDED', reason: 'policy violation' },
    });

    const roles = await request(app)
      .put(`/api/v1/admin/admins/${newId}/roles`)
      .set(authHeader(session.accessToken))
      .send({ roleKeys: ['sub_admin', 'support'] });
    expect(roles.status).toBe(200);
    expect(roles.body.data.added).toEqual(['sub_admin']);
    expect(roles.body.data.removed).toEqual([]);
  });

  it('super admin suspends support: login blocked + audit row with before/after', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const suspend = await request(app)
      .patch(`/api/v1/admin/admins/${await adminId(SUPPORT)}/status`)
      .set(authHeader(session.accessToken))
      .send({ status: 'SUSPENDED', reason: 'test suspension' });
    expect(suspend.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: SUPPORT, password: PW });
    expect(login.status).toBe(401);

    const audit = await request(app)
      .get('/api/v1/admin/audit-log?action=admin.suspend')
      .set(authHeader(session.accessToken));
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBe(1);
    expect(audit.body.data[0]).toMatchObject({
      action: 'admin.suspend',
      resourceType: 'admin',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
    });
    expect(audit.body.data[0].after).not.toHaveProperty('passwordHash');
  });

  it('super admin creates admin (hashed password, audit row); duplicates rejected', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const create = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({ email: 'new@x.com', password: 'Long-enough-123!', roleKeys: ['support'] });
    expect(create.status).toBe(201);

    const row = await getPrisma().adminUser.findUniqueOrThrow({
      where: { emailNormalized: 'new@x.com' },
    });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);

    const dup = await request(app)
      .post('/api/v1/admin/admins')
      .set(authHeader(session.accessToken))
      .send({ email: 'NEW@x.com', password: 'Long-enough-123!', roleKeys: ['support'] });
    expect(dup.status).toBe(409);

    const created = await getPrisma().adminAuditLog.count({ where: { action: 'admin.create' } });
    expect(created).toBe(1);
  });

  it('role creation and permission updates are super-gated and audited', async () => {
    const app = createApp();
    const session = await fullLogin(app, SUPER, PW);

    const create = await request(app)
      .post('/api/v1/admin/roles')
      .set(authHeader(session.accessToken))
      .send({ key: 'analyst', name: 'Analyst' });
    expect(create.status).toBe(201);

    const update = await request(app)
      .put('/api/v1/admin/roles/analyst/permissions')
      .set(authHeader(session.accessToken))
      .send({ permissionKeys: ['admin.read', 'audit.read'] });
    expect(update.status).toBe(200);

    const sub = await fullLogin(app, SUB, PW);
    const denied = await request(app)
      .put('/api/v1/admin/roles/analyst/permissions')
      .set(authHeader(sub.accessToken))
      .send({ permissionKeys: [] });
    expect(denied.status).toBe(403);
  });
});

async function adminId(email: string): Promise<string> {
  const admin = await getPrisma().adminUser.findUniqueOrThrow({
    where: { emailNormalized: email.toLowerCase() },
  });
  return admin.id;
}

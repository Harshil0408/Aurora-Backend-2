/**
 * Prisma seed: RBAC catalog + optional Super Admin bootstrap.
 *
 *   npx prisma db seed            # roles + permissions only
 *   SUPER_ADMIN_EMAIL=a@x.com SUPER_ADMIN_PASSWORD=<12+ chars> npx prisma db seed
 *
 * Idempotent (all upserts). The bootstrap admin is created ACTIVE with
 * 2FA NOT yet enrolled — 2FA enrollment becomes mandatory at first login
 * (implemented in the login stage).
 */
import 'dotenv/config';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { getPrisma } from '../src/config/db.js';
import { hashSecret } from '../src/modules/auth/crypto/password.js';
import { normalizeEmail } from '../src/modules/auth/utils/email.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_SEEDS,
  SUPER_ADMIN_ROLE_KEY,
} from '../src/modules/rbac/permissions.js';

async function seedCatalog(): Promise<void> {
  const prisma = getPrisma();

  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: `Grants ${key}` },
    });
  }

  for (const role of ROLE_SEEDS) {
    await prisma.adminRole.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      },
    });
  }

  // Super Admin holds all permissions implicitly; still materialize the
  // rows so permission listings are complete and auditable.
  const permissionRows = await prisma.permission.findMany({ select: { id: true, key: true } });
  const roleRows = await prisma.adminRole.findMany({ select: { id: true, key: true } });
  const permByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
  const roleByKey = new Map(roleRows.map((r) => [r.key, r.id]));

  const grants = new Map<string, string[]>();
  grants.set(SUPER_ADMIN_ROLE_KEY, [...ALL_PERMISSIONS]);
  for (const [roleKey, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    grants.set(roleKey, [...perms]);
  }

  for (const [roleKey, permKeys] of grants) {
    const roleId = roleByKey.get(roleKey);
    if (!roleId) throw new Error(`Role missing after upsert: ${roleKey}`);
    for (const permKey of permKeys) {
      const permissionId = permByKey.get(permKey);
      if (!permissionId) throw new Error(`Permission missing after upsert: ${permKey}`);
      await prisma.adminRolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }

  logger.info(`Seeded ${permissionRows.length} permissions, ${roleRows.length} roles`);
}

async function bootstrapSuperAdmin(): Promise<void> {
  const env = getEnv();
  if (!env.SUPER_ADMIN_EMAIL || !env.SUPER_ADMIN_PASSWORD) {
    logger.info('SUPER_ADMIN_EMAIL/PASSWORD not set — skipping admin bootstrap');
    return;
  }
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(env.SUPER_ADMIN_EMAIL);

  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  if (existing) {
    logger.info(`Super admin already exists: ${emailNormalized} — skipping`);
    return;
  }

  const superRole = await prisma.adminRole.findUnique({
    where: { key: SUPER_ADMIN_ROLE_KEY },
  });
  if (!superRole) throw new Error('super_admin role missing — seed catalog first');

  await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.create({
      data: {
        email: env.SUPER_ADMIN_EMAIL as string,
        emailNormalized,
        passwordHash: await hashSecret(env.SUPER_ADMIN_PASSWORD as string),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await tx.adminPasswordHistory.create({
      data: { adminId: admin.id, passwordHash: admin.passwordHash },
    });
    await tx.adminRoleAssignment.create({
      data: { adminId: admin.id, roleId: superRole.id },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: admin.id,
        action: 'admin.bootstrap',
        resourceType: 'admin',
        resourceId: admin.id,
        after: { email: emailNormalized, roles: [SUPER_ADMIN_ROLE_KEY] },
      },
    });
  });

  logger.info(`Bootstrapped super admin: ${emailNormalized}`);
}

async function main(): Promise<void> {
  try {
    await seedCatalog();
    await bootstrapSuperAdmin();
  } finally {
    const { disconnectDatabase } = await import('../src/config/db.js');
    await disconnectDatabase();
  }
}

void main().catch((err: unknown) => {
  logger.error('Seed failed', { error: err });
  process.exit(1);
});

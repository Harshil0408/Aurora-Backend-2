import { execSync } from 'node:child_process';
import mariadb from 'mariadb';
import { disconnectDatabase, getPrisma } from '../../src/config/db.js';
import { resetEnvCache } from '../../src/config/env.js';
import { hashSecret } from '../../src/modules/auth/crypto/password.js';
import { normalizeEmail } from '../../src/modules/auth/utils/email.js';

const TABLES = [
  'admin_audit_log',
  'admin_login_activity',
  'admin_password_history',
  'admin_password_reset_tokens',
  'admin_recovery_codes',
  'admin_role_assignments',
  'admin_role_permissions',
  'admin_sessions',
  'admin_users',
  'admin_roles',
  'permissions',
];

export function getTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return url;
}

/** Create ecomm_test if missing + deploy migrations. Idempotent, once per run. */
export async function ensureTestDatabase(): Promise<void> {
  const testUrl = getTestDatabaseUrl();
  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, '');

  const conn = await mariadb.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  } finally {
    await conn.end();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}

/** Empty all domain tables (keeps _prisma_migrations). */
export async function truncateTestTables(): Promise<void> {
  resetEnvCache();
  const prisma = getPrisma();
  // Interactive transaction pins ONE pooled connection, so the session
  // variable FOREIGN_KEY_CHECKS applies to every TRUNCATE below.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of TABLES) {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
      }
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

export interface TestAdminInput {
  email?: string;
  password?: string;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
}

export async function createTestAdmin(input: TestAdminInput = {}): Promise<{ id: string }> {
  const prisma = getPrisma();
  const email = input.email ?? 'admin@local.test';
  const admin = await prisma.adminUser.create({
    data: {
      email,
      emailNormalized: normalizeEmail(email),
      passwordHash: await hashSecret(input.password ?? 'Correct-123!'),
      status: input.status ?? 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  // Mirror production creation paths: current password is history row #1.
  await prisma.adminPasswordHistory.create({
    data: { adminId: admin.id, passwordHash: admin.passwordHash },
  });
  return { id: admin.id };
}

export async function closeTestDatabase(): Promise<void> {
  await disconnectDatabase();
}

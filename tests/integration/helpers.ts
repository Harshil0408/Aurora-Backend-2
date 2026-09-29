import { execSync } from 'node:child_process';
import pg from 'pg';
import { disconnectDatabase, getPrisma } from '../../src/config/db.js';
import { resetEnvCache } from '../../src/config/env.js';
import { hashSecret } from '../../src/modules/admin-panel/auth/crypto/password.js';
import { normalizeEmail } from '../../src/modules/admin-panel/auth/utils/email.js';

const TABLES = [
  'admin_audit_log',
  'admin_login_activity',
  'admin_password_history',
  'admin_password_reset_tokens',
  'admin_email_otps',
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
  const dbName = url.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!dbName) throw new Error('TEST_DATABASE_URL must include a database name');

  // Connect to the server's default `postgres` database to create the target.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } catch (err) {
    // 42P04 = duplicate_database — already exists, keep going.
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await client.end();
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
  // Single TRUNCATE ... CASCADE handles FKs without session variables.
  const tables = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
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

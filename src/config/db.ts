import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';

const { Pool } = pg;

function createAdapter(): PrismaPg {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!database) throw new Error('DATABASE_URL must include a database name');

  const sslMode = (
    url.searchParams.get('sslmode') ??
    url.searchParams.get('ssl-mode') ??
    url.searchParams.get('ssl') ??
    ''
  ).toUpperCase();
  const sslRequired = ['REQUIRE', 'REQUIRED', 'VERIFY-CA', 'VERIFY-FULL', 'PREFER'].includes(
    sslMode,
  );
  const ca = process.env['DATABASE_SSL_CA'];

  // node-postgres honors `sslmode` from the connection string (e.g. Neon),
  // but explicit options take precedence — use them for CA pinning.
  const pool = new Pool({
    connectionString,
    max: 10,
    ...(ca
      ? { ssl: { ca, rejectUnauthorized: true } }
      : sslRequired
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
  });
  return new PrismaPg(pool);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient | undefined };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({ adapter: createAdapter() });
  }
  return globalForPrisma.prisma;
}

export async function connectDatabase(): Promise<void> {
  await getPrisma().$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
  logger.info('Database disconnected');
}

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';

function createAdapter(): PrismaMariaDb {
  const raw = process.env['DATABASE_URL'];
  if (!raw) throw new Error('DATABASE_URL is required');
  const url = new URL(raw);
  // Aiven / managed MySQL requires TLS (`?ssl-mode=REQUIRED`). The old code
  // silently dropped query params, so prod connections failed the SSL check.
  const sslParam = (
    url.searchParams.get('ssl-mode') ??
    url.searchParams.get('sslmode') ??
    url.searchParams.get('ssl') ??
    ''
  ).toUpperCase();
  const sslRequired = ['REQUIRED', 'REQUIRE', 'TRUE', '1', 'PREFERRED'].includes(sslParam);
  const ca = process.env['DATABASE_SSL_CA'];
  const database = url.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!database) throw new Error('DATABASE_URL must include a database name');
  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: 10,
    // MySQL 8 uses caching_sha2_password. Over non-TLS dev connections
    // (Docker on 127.0.0.1:3308) the mariadb driver must be allowed to
    // fetch the server's RSA public key, otherwise every query fails with
    // pool timeout (code 45028) caused by 45044 RSA public key unavailable.
    // Harmless for TLS (Aiven) connections.
    allowPublicKeyRetrieval: true,
    // Encrypted but without a pinned CA by default (works on Aiven/RDS).
    // To pin the CA: set DATABASE_SSL_CA to the PEM contents.
    ...(sslRequired ? { ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false } } : {}),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient | undefined };

/**
 * Lazy singleton — importing this module never opens a connection or
 * throws (important for tests that don't need a database).
 */
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

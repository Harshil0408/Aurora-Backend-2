import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';

function createAdapter(): PrismaMariaDb {
  const raw = process.env['DATABASE_URL'];
  if (!raw) throw new Error('DATABASE_URL is required');
  const url = new URL(raw);
  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 10,
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

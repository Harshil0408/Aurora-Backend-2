import { Redis } from 'ioredis';
import { logger } from './logger.js';

let client: Redis | undefined;
let warned = false;

function warnOnce(message: string): void {
  if (!warned) {
    warned = true;
    logger.warn(message);
  }
}

/**
 * Lazily create the Redis client. Uses lazyConnect so importing this
 * module never opens a connection (tests that don't need Redis stay fast).
 * Callers must handle null (Redis unavailable) gracefully — Redis is a
 * cache/rate-limit aid, never the source of truth.
 */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    client.on('error', (err: unknown) => {
      warnOnce(`Redis unavailable, continuing without cache: ${(err as Error).message}`);
    });
  }
  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    client = undefined;
  }
}

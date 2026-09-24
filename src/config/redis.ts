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
 * Lazily create the native Redis client (ioredis). Uses lazyConnect so importing
 * this module never opens a connection (tests that don't need Redis stay fast).
 * Callers must handle null (Redis unavailable) gracefully — Redis is a
 * cache/rate-limit aid, never the source of truth.
 *
 * NOTE: ioredis cannot speak Upstash's HTTPS REST API. When only
 * UPSTASH_REDIS_REST_URL/TOKEN are set (no native `rediss://` URL),
 * use pingRedis() for health checks — it speaks REST via fetch.
 * For session/cache commands, add Upstash's native Redis URL as REDIS_URL.
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
  // Prefer Upstash REST when configured — works without a native connection.
  const restUrl = process.env['UPSTASH_REDIS_REST_URL'];
  const restToken = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (restUrl && restToken) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000).unref?.() ?? setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(`${restUrl.replace(/\/$/, '')}/ping`, {
          headers: { Authorization: `Bearer ${restToken}` },
          signal: controller.signal,
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { result?: unknown };
        return body.result === 'PONG';
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
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

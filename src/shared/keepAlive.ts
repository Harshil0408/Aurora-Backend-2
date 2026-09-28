import { logger } from '../config/logger.js';
import type { Env } from '../config/env.js';

type KeepAliveEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'PORT'
  | 'API_PREFIX'
  | 'RENDER_EXTERNAL_URL'
  | 'KEEP_ALIVE_ENABLED'
  | 'KEEP_ALIVE_INTERVAL_MS'
  | 'KEEP_ALIVE_URL'
>;

export interface KeepAliveTarget {
  url: string;
  intervalMs: number;
}

/** Explicit opt-out wins; otherwise on in production, off elsewhere (incl. tests). */
export function shouldStartKeepAlive(env: KeepAliveEnv): boolean {
  if (env.KEEP_ALIVE_ENABLED !== undefined) return env.KEEP_ALIVE_ENABLED;
  return env.NODE_ENV === 'production';
}

/**
 * Resolve the public URL to ping. Render counts inbound traffic against
 * spin-down, so in production we must hit the public URL (Render injects
 * RENDER_EXTERNAL_URL automatically) — a localhost self-ping never leaves
 * the container and would NOT keep the service alive.
 */
export function resolveKeepAliveTarget(env: KeepAliveEnv): KeepAliveTarget | null {
  const base = env.KEEP_ALIVE_URL ?? env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${env.PORT}`;
  const isLoopback = base.includes('127.0.0.1') || base.includes('localhost');
  if (env.NODE_ENV === 'production' && isLoopback && env.KEEP_ALIVE_ENABLED !== true) {
    logger.warn('Keep-alive skipped: no public URL (set KEEP_ALIVE_URL or RENDER_EXTERNAL_URL)');
    return null;
  }
  const path = `${env.API_PREFIX}/health`.replace(/\/+$/, '');
  return { url: `${base.replace(/\/+$/, '')}${path}`, intervalMs: env.KEEP_ALIVE_INTERVAL_MS };
}

async function ping(url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) logger.warn('Keep-alive ping unhealthy', { url, status: res.status });
    else logger.debug('Keep-alive ping ok', { url });
  } catch (err) {
    logger.warn('Keep-alive ping failed', { url, error: err });
  }
}

/** Start the self-ping loop. Returns a stop function. Timer is unref'd. */
export function startKeepAlive(target: KeepAliveTarget): () => void {
  logger.info('Keep-alive self-ping started', { url: target.url, intervalMs: target.intervalMs });
  const timer = setInterval(() => void ping(target.url), target.intervalMs);
  const maybeUnref = timer as unknown as { unref?: () => void };
  maybeUnref.unref?.();
  return () => clearInterval(timer);
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveKeepAliveTarget,
  shouldStartKeepAlive,
  startKeepAlive,
} from '../src/shared/keepAlive.js';

function baseEnv() {
  return {
    NODE_ENV: 'production' as const,
    PORT: 4000,
    API_PREFIX: '/api/v1',
    RENDER_EXTERNAL_URL: undefined as string | undefined,
    KEEP_ALIVE_ENABLED: undefined as boolean | undefined,
    KEEP_ALIVE_INTERVAL_MS: 4590,
    KEEP_ALIVE_URL: undefined as string | undefined,
  };
}

describe('keep-alive', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is on by default in production, off elsewhere', () => {
    expect(shouldStartKeepAlive(baseEnv())).toBe(true);
    expect(shouldStartKeepAlive({ ...baseEnv(), NODE_ENV: 'development' })).toBe(false);
    expect(shouldStartKeepAlive({ ...baseEnv(), NODE_ENV: 'test' })).toBe(false);
  });

  it('explicit flag wins over the default', () => {
    expect(shouldStartKeepAlive({ ...baseEnv(), KEEP_ALIVE_ENABLED: false })).toBe(false);
    expect(
      shouldStartKeepAlive({ ...baseEnv(), NODE_ENV: 'development', KEEP_ALIVE_ENABLED: true }),
    ).toBe(true);
  });

  it('prefers KEEP_ALIVE_URL, then RENDER_EXTERNAL_URL, then loopback', () => {
    expect(resolveKeepAliveTarget({ ...baseEnv(), NODE_ENV: 'development' })?.url).toBe(
      'http://127.0.0.1:4000/api/v1/health',
    );
    expect(
      resolveKeepAliveTarget({
        ...baseEnv(),
        RENDER_EXTERNAL_URL: 'https://svc.onrender.com',
      })?.url,
    ).toBe('https://svc.onrender.com/api/v1/health');
    expect(
      resolveKeepAliveTarget({
        ...baseEnv(),
        RENDER_EXTERNAL_URL: 'https://svc.onrender.com',
        KEEP_ALIVE_URL: 'https://custom.example.com/',
      })?.url,
    ).toBe('https://custom.example.com/api/v1/health');
  });

  it('refuses loopback in production unless explicitly enabled', () => {
    expect(resolveKeepAliveTarget(baseEnv())).toBeNull();
    expect(resolveKeepAliveTarget({ ...baseEnv(), KEEP_ALIVE_ENABLED: true })?.url).toBe(
      'http://127.0.0.1:4000/api/v1/health',
    );
  });

  it('pings every interval and stops on demand', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const stop = startKeepAlive({
      url: 'https://svc.onrender.com/api/v1/health',
      intervalMs: 4590,
    });

    await vi.advanceTimersByTimeAsync(4590 * 2 + 100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://svc.onrender.com/api/v1/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    stop();
    await vi.advanceTimersByTimeAsync(4590 * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

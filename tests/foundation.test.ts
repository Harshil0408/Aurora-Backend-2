import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/shared/errors/AppError.js';
import { getEnv, resetEnvCache } from '../src/config/env.js';

describe('env validation', () => {
  it('rejects missing DATABASE_URL', () => {
    const saved = { ...process.env };
    resetEnvCache();
    delete process.env['DATABASE_URL'];
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    process.env = saved;
    resetEnvCache();
  });
});

describe('AppError', () => {
  it('maps codes to HTTP status', () => {
    expect(new AppError('NOT_FOUND', 'x').statusCode).toBe(404);
    expect(new AppError('UNAUTHORIZED', 'x').statusCode).toBe(401);
    expect(new AppError('RATE_LIMITED', 'x').statusCode).toBe(429);
  });
});

describe('zod sanity', () => {
  it('validates email shape', () => {
    const schema = z.object({ email: z.email() });
    expect(schema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ email: 'admin@example.com' }).success).toBe(true);
  });
});

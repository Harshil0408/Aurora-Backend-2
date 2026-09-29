// Integration-test environment defaults. Loaded via
// vitest.integration.config.ts — never by the unit suite.
process.env['NODE_ENV'] ??= 'test';
process.env['TEST_DATABASE_URL'] ??= 'postgresql://ecomm:ecomm_dev_password@127.0.0.1:5433/ecomm_test';
process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] as string;
process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';
process.env['LOGIN_RATE_LIMIT_MAX'] ??= '1000';

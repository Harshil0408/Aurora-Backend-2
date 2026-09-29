// Vitest global setup — deterministic, hermetic defaults.
// Tests must never require a real database/redis; endpoints that probe
// infra (e.g. /ready) will simply report "down" under these values.
process.env['NODE_ENV'] ??= 'test';
process.env['DATABASE_URL'] ??= 'postgresql://ecomm:ecomm_dev_password@127.0.0.1:5433/ecomm_test';
process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';

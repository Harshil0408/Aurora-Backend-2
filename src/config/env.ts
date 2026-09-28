import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  UPSTASH_REDIS_REST_URL: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  DATABASE_SSL_CA: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be >= 32 chars')
    .default('dev-only-change-me-0123456789abcdef'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  REFRESH_TOKEN_PEPPER: z.string().min(1).default('dev-only-pepper'),
  TOTP_ENCRYPTION_KEY: z.string().min(1).default('dev-only-totp-key'),

  SUPER_ADMIN_EMAIL: z.email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(12, 'SUPER_ADMIN_PASSWORD must be >= 12 chars').optional(),

  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  SMTP_TLS_INSECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  FRONTEND_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    // Normalize: trim whitespace, drop trailing slashes, support a
    // comma-separated allowlist (first entry = canonical app URL used
    // for absolute links such as password-reset mails). Without this,
    // `https://app.vercel.app/` never equals the browser-sent
    // `Origin: https://app.vercel.app` and cors blocks every call.
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
        .join(','),
    )
    .refine((v) => v.length > 0, 'FRONTEND_ORIGIN is required'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  TEST_DATABASE_URL: z.string().min(1).optional(),

  RENDER_EXTERNAL_URL: z.string().min(1).optional(),
  KEEP_ALIVE_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  KEEP_ALIVE_INTERVAL_MS: z.coerce.number().int().min(1000).default(4590),
  KEEP_ALIVE_URL: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** All allowed browser origins (comma-separated FRONTEND_ORIGIN). */
export function getAllowedOrigins(env: Env = getEnv()): string[] {
  return env.FRONTEND_ORIGIN.split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Canonical app URL (first origin) — use for absolute links in mails. */
export function getPrimaryOrigin(env: Env = getEnv()): string {
  return getAllowedOrigins(env)[0] ?? 'http://localhost:3000';
}

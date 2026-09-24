import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Upstash Redis REST (production). When both are set, health checks use
  // the REST API instead of a native Redis connection. Native `rediss://`
  // URL is still preferred for session/cache features (ioredis can't speak REST).
  UPSTASH_REDIS_REST_URL: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Optional PEM for managed MySQL (Aiven/RDS). When set + ?ssl-mode=REQUIRED,
  // the driver pins this CA instead of encrypted-but-unverified TLS.
  DATABASE_SSL_CA: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be >= 32 chars')
    .default('dev-only-change-me-0123456789abcdef'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  REFRESH_TOKEN_PEPPER: z.string().min(1).default('dev-only-pepper'),
  TOTP_ENCRYPTION_KEY: z.string().min(1).default('dev-only-totp-key'),

  // Super Admin bootstrap (used only by prisma/seed.ts; never by the app).
  SUPER_ADMIN_EMAIL: z.email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(12, 'SUPER_ADMIN_PASSWORD must be >= 12 chars').optional(),

  // Outgoing mail. When SMTP_HOST/USER/PASS are all set, real mail is sent;
  // otherwise the LogMailer logs instead (dev default — nothing leaves the box).
  // Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_SECURE=false,
  // SMTP_USER=you@gmail.com, SMTP_PASS=<16-char App Password, NOT login password>.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),

  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // Isolated integration-test database (never production).
  TEST_DATABASE_URL: z.string().min(1).optional(),

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

/** Test-only helper to reset the cached env between tests. */
export function resetEnvCache(): void {
  cached = undefined;
}

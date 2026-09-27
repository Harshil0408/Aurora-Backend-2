# AGENTS.md — ecomm-backend

Modular monolith: Express 5 + TypeScript (NodeNext ESM) + Prisma 7 + MySQL 8 + Redis 8. Node `22.x`.

## Entrypoints & layout

- `src/server.ts` — listen + graceful shutdown (DB/Redis disconnect, 10s force-exit). `src/app.ts` — `createApp()` factory (all middleware/routes; use it in tests, not `server.ts`).
- `src/modules/{auth,admin,rbac,audit,health}/` — domain code. `src/config/{env,db,redis}.ts` — infra singletons. `src/shared/middleware/` — requestId/logger/errorHandler. `src/docs/` — Swagger at `/api/docs`.
- Prisma client is imported from `src/generated/prisma/client.js` (generated assets live in `src/generated/` and are copied to `dist/` at build — see below).
- Prisma 7: datasource URL lives in `prisma.config.ts` via `env('DATABASE_URL')`, never in `schema.prisma`. Seed is `tsx prisma/seed.ts` (needs `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` ≥12 chars to bootstrap a Super Admin).

## Commands (exact)

- Setup: `npm install` → `docker compose up -d mysql redis` → `npx prisma migrate dev` → `npx prisma db seed` → `npm run dev` (tsx watch, API `:4000`, docs `/api/docs`).
- Verify: `npm run typecheck` (real type gate, strict) → `npm run format:check` → `npm test`. `npm run lint` only lints `scripts/` + `eslint.config.mjs` — it does NOT cover `src/`/`tests/` (typescript-eslint deferred for TS 7 compat; do not "fix" by adding it back without TS 7.1 support).
- Build/start: `npm run build` = `prisma generate && tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`. Never skip `copy-generated.mjs` — `tsc` drops generated `.js`/wasm. Then `npm start` (`node dist/server.js`).
- Single unit test: `npx vitest run tests/<name>.test.ts`. Single integration test: `npx vitest run --config vitest.integration.config.ts tests/integration/<name>.test.ts`.
- DB/Redis probes: `docker exec ecomm-mysql mysql -uecomm -pecomm_dev_password ecomm -e "SHOW TABLES;"`, `docker exec ecomm-redis redis-cli ping`, `GET localhost:4000/api/v1/health/ready`.

## Gotchas

- MySQL host port is **`127.0.0.1:3308` deliberately** (host 3306/3307 taken). `DATABASE_URL` uses 3308 locally; inside compose the `api` service uses `mysql:3306`. `P1001` = MySQL still starting (`docker compose ps` until healthy). Shadow-DB error on migrate = `ecomm` user needs CREATE DATABASE once (persists in volume).
- Env is zod-validated and **cached** in `src/config/env.ts` (`getEnv()`); tests must call `resetEnvCache()` after changing `process.env`. `dotenv/config` is loaded in `server.ts` and `prisma.config.ts` only — plain module imports do not load `.env`.
- Unit suite (`vitest.config.ts`) excludes `tests/integration/`, runs `singleFork`. Integration suite uses isolated `ecomm_test` DB: setup forces `DATABASE_URL=TEST_DATABASE_URL`, bumps `LOGIN_RATE_LIMIT_MAX=1000`, auto-creates DB + `prisma migrate deploy`, truncates all `admin_*` tables per test. Requires MySQL + Redis up. Never point `TEST_DATABASE_URL` at production.
- Outside local dev, `TOTP_ENCRYPTION_KEY` must be 64 hex chars (32 bytes). Mail is log-only unless `SMTP_HOST/USER/PASS` are all set (Gmail needs a 16-char App Password, not the login password).
- Auth model: `POST /admin/auth/login` returns a 2FA-pending token, never a session — pending token drives enroll/confirm/verify, then access JWT + `admin_rt` cookie with rotation + reuse detection.
- Imports must use `.js` suffixes (`./config/env.js`) for NodeNext; use `import type` where type-only (`verbatimModuleSyntax`). Prettier: single quotes, semicolons, 100-col.

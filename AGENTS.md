# AGENTS.md — ecomm-backend

Modular monolith: Express 5 + TypeScript (NodeNext ESM) + Prisma 7 + Postgres 17 (local Docker) / Neon Postgres (prod) + Redis 8. Node `22.x`.

## Entrypoints & layout

- `src/server.ts` — listen + graceful shutdown (DB/Redis disconnect, 10s force-exit). `src/app.ts` — `createApp()` factory (all middleware/routes; use it in tests, not `server.ts`).
- `src/modules/{admin-panel,rbac,audit,health}/` — domain code. `src/config/{env,db,redis}.ts` — infra singletons. `src/shared/middleware/` — requestId/logger/errorHandler. `src/shared/validation/` — shared zod shapes (e.g. pagination). `src/docs/` — Swagger at `/api/docs`.
- Module pattern (follow for every new panel/area): `src/modules/<panel>/<area>/<screen>/` with `<screen>.service.ts` + `<screen>.controller.ts` + `<screen>.routes.ts` + `<screen>.schemas.ts`, composed by `<area>.routes.ts` and `<panel>.routes.ts`. Example: `admin-panel/{auth,administration/{admins,roles-permissions,activity-log,sessions}}/`. Truly cross-panel kernels (`rbac/` permission constants, `audit/` writer) stay top-level and are imported by panel modules — never duplicated. Panel-identity code (per-panel auth, sessions, middleware) lives INSIDE its panel. Public URL paths must not change on a pure reorganization.
- Prisma client is imported from `src/generated/prisma/client.js` (generated assets live in `src/generated/` and are copied to `dist/` at build — see below).
- Prisma 7: datasource URL lives in `prisma.config.ts` via `env('DATABASE_URL')`, never in `schema.prisma`. Seed is `tsx prisma/seed.ts` (needs `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` ≥12 chars to bootstrap a Super Admin).

## Commands (exact)

- Setup: `npm install` → `docker compose up -d postgres redis` → `npm run prisma:migrate:local` (or `npx prisma migrate dev`) → `npm run db:seed:local` → `npm run dev:local` (tsx watch, API `:4000`, docs `/api/docs`). Prod uses Neon: `npm run prisma:deploy:production` + `npm run db:seed:production` (see `.env.production`).
- Verify: `npm run typecheck` (real type gate, strict) → `npm run format:check` → `npm test`. `npm run lint` only lints `scripts/` + `eslint.config.mjs` — it does NOT cover `src/`/`tests/` (typescript-eslint deferred for TS 7 compat; do not "fix" by adding it back without TS 7.1 support).
- Build/start: `npm run build` = `prisma generate && tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`. Never skip `copy-generated.mjs` — `tsc` drops generated `.js`/wasm. Then `npm start` (`node dist/server.js`).
- Single unit test: `npx vitest run tests/<name>.test.ts`. Single integration test: `npx vitest run --config vitest.integration.config.ts tests/integration/<name>.test.ts`.
- DB/Redis probes: `docker exec ecomm-postgres psql -Uecomm -decomm -c "\dt"`, `docker exec ecomm-redis redis-cli ping`, `GET localhost:4000/api/v1/health/ready`.

## Panels (multi-panel rule — never violate)

- URL namespace per panel: `/api/v1/<panel>/…`. Today: `/api/v1/admin/*`. Future: `/api/v1/seller/*`, `/api/v1/user/*`, … Generic leaf names (`/auth/login`, `/auth/me`) live UNDER the panel prefix, so panels can never collide. Never mount a panel route outside its namespace.
- Code per panel: `src/modules/<panel>/` with a `<panel>.routes.ts` composer; `src/app.ts` mounts exactly ONE router per panel (`app.use(API_PREFIX + '/<panel>', <panel>Router)`). Panel identity (auth, sessions, middleware, validation) lives inside its panel — copy the `admin-panel/auth/` shape for the next panel, never import another panel's auth.
- Adding a panel = new `src/modules/<panel>/` folder + one `app.use` line + panel tag in `openapi.ts`. Shared code goes to `src/shared/` or a top-level kernel (`rbac/`, `audit/`) only if ≥2 panels truly share it.

## Gotchas

- Local Postgres host port is **`127.0.0.1:5433` deliberately** (5432 is blocked on Windows by Hyper-V reserved ranges). `DATABASE_URL`/`TEST_DATABASE_URL` use 5433 locally; inside compose the `api` service uses `postgres:5432`. `P1001` = Postgres still starting (`docker compose ps` until healthy) or Neon compute cold-starting (retry). First Neon deploy attempt after idle may fail — retry once.
- Env is zod-validated and **cached** in `src/config/env.ts` (`getEnv()`); tests must call `resetEnvCache()` after changing `process.env`. `dotenv/config` is loaded in `server.ts` and `prisma.config.ts` only — plain module imports do not load `.env`.
- Unit suite (`vitest.config.ts`) excludes `tests/integration/`, runs `singleFork`. Integration suite uses isolated `ecomm_test` DB on local Postgres: setup forces `DATABASE_URL=TEST_DATABASE_URL`, bumps `LOGIN_RATE_LIMIT_MAX=1000`, auto-creates DB + `prisma migrate deploy`, truncates all `admin_*` tables per test (`TRUNCATE ... CASCADE`). Requires Postgres + Redis up. Never point `TEST_DATABASE_URL` at production.
- Outside local dev, `TOTP_ENCRYPTION_KEY` must be 64 hex chars (32 bytes). Mail is log-only unless `SMTP_HOST/USER/PASS` are all set (Gmail needs a 16-char App Password, not the login password).
- Auth model: `POST /admin/auth/login` with no 2FA method returns a session directly; with TOTP/email-OTP enabled it returns a 2FA-pending token (+ `channel`) driving enroll/confirm/verify, then access JWT + `admin_rt` cookie with rotation + reuse detection.
- Imports must use `.js` suffixes (`./config/env.js`) for NodeNext; use `import type` where type-only (`verbatimModuleSyntax`). Prettier: single quotes, semicolons, 100-col.
- API contract lives in `src/docs/openapi.ts` — edit it when routes/bodies change, then run `npm run postman:export` and commit `postman/` (live collection also served at `GET /api/docs/postman`).

# E-Comm Backend — Admin Auth (Phases 1–2 complete)

Modular monolith: Express 5 + TypeScript 7 + Prisma 7 + Postgres 17 (local Docker) / Neon Postgres (prod) + Redis 8.
Admin auth: password login → mandatory TOTP 2FA → short JWT + rotating refresh sessions, RBAC, audit trail.

## Quick start

1. Copy `.env.example` to `.env` and fill secrets (`TOTP_ENCRYPTION_KEY` = 64 hex chars outside local dev).
2. `npm install`
3. `docker compose up -d postgres redis` — Postgres on `127.0.0.1:5433`, Redis on `6379`.
4. `npm run prisma:migrate:local` — apply migrations (`admin_*` tables).
5. `npm run db:seed:local` — roles + permissions; add `SUPER_ADMIN_EMAIL/PASSWORD` env to bootstrap a Super Admin.
6. `npm run dev:local` — API on http://localhost:4000; docs at http://localhost:4000/api/docs
   (`npm run dev` is an alias; `npm run dev:production` runs the same code against `.env.production`)
7. View data: `npx prisma studio`, or `docker exec ecomm-postgres psql -Uecomm -decomm -c "\dt"`.

## Verification

| Check | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Lint + format | `npm run lint`, `npm run format:check` |
| Unit tests | `npm test` |
| Integration tests (isolated `ecomm_test` DB) | `npm run test:integration` |
| Build | `npm run build` |
| DB tables | `docker exec ecomm-postgres psql -Uecomm -decomm -c "\dt"` |
| Redis | `docker exec ecomm-redis redis-cli ping` |
| Ready probe | `GET localhost:4000/api/v1/health/ready` |

## Auth endpoints (`/api/v1`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/auth/login` | — | password → 2FA-pending token (never a session) |
| POST | `/admin/auth/2fa/enroll` | pending | QR + one-time recovery codes |
| POST | `/admin/auth/2fa/confirm` | pending | activates 2FA |
| POST | `/admin/auth/2fa/verify` | pending | TOTP/recovery → access JWT + `admin_rt` cookie |
| POST | `/admin/auth/refresh` | cookie | rotation + reuse detection |
| POST | `/admin/auth/logout` | JWT | revoke current session |
| POST | `/admin/auth/logout-all` | JWT | revoke all + kill JWTs |
| GET/DELETE | `/admin/auth/sessions…` | JWT | own sessions; others need `session.revoke` |
| POST | `/admin/auth/forgot-password` | — | always generic 200 |
| POST | `/admin/auth/reset-password` | — | single-use, history-checked |
| POST | `/admin/auth/change-password` | JWT | reauth, kills sessions |
| POST | `/admin/auth/2fa/disable` | JWT | password + 2FA reauth |
| GET/POST | `/admin/admins` | `admin.read/create` | — |
| PATCH | `/admin/admins/:id/status` | `admin.suspend` | never self / last Super Admin |
| PUT | `/admin/admins/:id/roles` | `role.assign` | escalation-guarded |
| GET/POST | `/admin/roles` | `role.read/create` | — |
| PUT | `/admin/roles/:key/permissions` | `role.update` | replace (super_admin: SA-only) |
| POST | `/admin/roles/:key/permissions` | `role.update` | add-only, idempotent |
| DELETE | `/admin/roles/:key/permissions` | `role.update` | remove-only, idempotent |
| GET | `/admin/audit-log` | `audit.read` | paginated, `?action=` filter |
| GET | `/admin/activity` | `audit.read` | feed: snapshots + diffs, `?action=&q=&actor=&from=&to=&sort=` |
| GET | `/admin/activity/actions` | `audit.read` | filter options + counts |
| GET | `/admin/activity/:id` | `audit.read` | single entry |

## Common errors

- `P1001 Can't reach database` → Postgres still starting (`docker compose ps` until healthy), or Neon compute cold-starting (retry once).
- Port conflicts: host 5432 is blocked on Windows (Hyper-V reserved range) — project Postgres is on **5433** deliberately.
- `tsc.exe` missing after install (OneDrive placeholder) → reinstall `@typescript/typescript-win32-x64`.

## Production notes (NOT production-ready yet)

Implemented now: Argon2id, TOTP+recovery, rotation/reuse detection, lockout, RBAC, audit, rate limits, security headers, graceful shutdown.
Still needs prod infra: secrets manager, real mail provider (LogMailer now), TLS + reverse proxy, `prisma migrate deploy` in CI, Sentry, backups, `npm audit`, 64-hex `TOTP_ENCRYPTION_KEY`.

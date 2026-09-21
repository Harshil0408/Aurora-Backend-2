# E-Comm Backend — Foundation (Phase 1)

Modular monolith: Express 5 + TypeScript 7 + Prisma 7 + MySQL 8 + Redis 8.

## Quick start

1. `cp .env.example .env` — set `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, secrets.
2. `npm install`
3. `docker compose up -d --build` — starts api + mysql + redis + phpMyAdmin.
4. `npm run prisma:migrate` — apply migrations (creates `admin_*` tables).
5. `npm run prisma:generate` — regenerate Prisma Client (auto-runs on migrate).
6. `npm run dev` — API on http://localhost:4000/api/v1/health
7. phpMyAdmin: http://localhost:8080 (server `mysql`, user `ecomm`).

## Verification

| Check | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Tests | `npm test` |
| Build | `npm run build` |
| DB query | `docker compose exec mysql mysql -uecomm -p ecomm -e "SHOW TABLES;"` |
| Redis | `docker compose exec redis redis-cli ping` |
| Ready probe | `curl localhost:4000/api/v1/health/ready` |

## Common errors

- `P1001 Can't reach database` → MySQL still starting; wait for healthy (`docker compose ps`), check `DATABASE_URL` host (`mysql` inside Docker, `127.0.0.1` outside).
- `REDIS_URL` failures → API still boots (Redis is cache-only); check `docker compose logs redis`.
- Prisma `shadow database` error on MySQL → grant privileges to `ecomm` user or run migrate with root URL.
- Port conflicts (3306/6379/8080/4000) → stop local MySQL/Redis or remap ports in compose.
- `EACCES` on Windows/OneDrive → run terminal as normal user, avoid syncing `node_modules` (already gitignored).

## Production notes (NOT production-ready yet)

Phase 1 is a dev foundation. Before prod: secrets manager, `prisma migrate deploy` in CI, remove phpMyAdmin/ exposed ports, TLS + reverse proxy, Sentry, backups, `npm audit`.

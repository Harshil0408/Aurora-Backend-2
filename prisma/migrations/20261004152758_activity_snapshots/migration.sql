-- Activity Log read API: denormalized write-time snapshots so history rows
-- survive later renames/deletes (no JOINs at read time), plus a createdAt
-- index for newest-first listing and date-range filters.
ALTER TABLE "admin_audit_log" ADD COLUMN "actorEmail" VARCHAR(320);
ALTER TABLE "admin_audit_log" ADD COLUMN "actorName" VARCHAR(128);
ALTER TABLE "admin_audit_log" ADD COLUMN "resourceLabel" VARCHAR(320);
ALTER TABLE "admin_audit_log" ADD COLUMN "userAgent" TEXT;
CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");

-- Backfill actor snapshots from admins that still exist.
UPDATE "admin_audit_log" AS a
SET "actorEmail" = u."email", "actorName" = u."name"
FROM "admin_users" AS u
WHERE a."actorId" = u."id" AND a."actorEmail" IS NULL;

-- Backfill resource labels: permission rows carry the key as resourceId.
UPDATE "admin_audit_log"
SET "resourceLabel" = "resourceId"
WHERE "resourceType" = 'permission' AND "resourceId" IS NOT NULL AND "resourceLabel" IS NULL;

-- Admin targets resolve to their email at migration time.
UPDATE "admin_audit_log" AS a
SET "resourceLabel" = u."email"
FROM "admin_users" AS u
WHERE a."resourceType" = 'admin' AND a."resourceId" = u."id" AND a."resourceLabel" IS NULL;

-- Role targets are keyed by role key (not id).
UPDATE "admin_audit_log" AS a
SET "resourceLabel" = r."name"
FROM "admin_roles" AS r
WHERE a."resourceType" = 'role' AND a."resourceId" = r."key" AND a."resourceLabel" IS NULL;

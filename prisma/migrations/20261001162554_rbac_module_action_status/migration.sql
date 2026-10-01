-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PermissionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable: roles + users (safe defaults)
ALTER TABLE "admin_roles" ADD COLUMN "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "admin_users" ADD COLUMN "permissionsVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: permissions — add as nullable first for backfill
ALTER TABLE "permissions" ADD COLUMN "action" VARCHAR(64),
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "label" VARCHAR(128),
ADD COLUMN "module" VARCHAR(64),
ADD COLUMN "status" "PermissionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "key" TYPE VARCHAR(128);

-- Backfill module/action from canonical key (module.action)
UPDATE "permissions" SET "module" = split_part("key", '.', 1), "action" = split_part("key", '.', 2) WHERE "module" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "permissions" ALTER COLUMN "module" SET NOT NULL;
ALTER TABLE "permissions" ALTER COLUMN "action" SET NOT NULL;

-- CreateIndex
CREATE INDEX "admin_roles_status_idx" ON "admin_roles"("status");
CREATE INDEX "permissions_module_idx" ON "permissions"("module");
CREATE INDEX "permissions_status_idx" ON "permissions"("status");

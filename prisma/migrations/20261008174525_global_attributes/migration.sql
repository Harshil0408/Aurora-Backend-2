-- CreateEnum
CREATE TYPE "AttributeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "attributes" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "value" VARCHAR(255),
    "description" VARCHAR(500),
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "AttributeStatus" NOT NULL DEFAULT 'ACTIVE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attributes_type_status_sortOrder_idx" ON "attributes"("type", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_type_key_key" ON "attributes"("type", "key");

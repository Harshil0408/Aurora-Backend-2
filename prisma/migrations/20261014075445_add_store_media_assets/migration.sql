-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "store_media_assets" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(128) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "storageKey" VARCHAR(512) NOT NULL,
    "url" VARCHAR(1024),
    "width" INTEGER,
    "height" INTEGER,
    "altText" VARCHAR(255),
    "caption" VARCHAR(500),
    "folder" VARCHAR(128) NOT NULL DEFAULT 'general',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedBy" VARCHAR(64),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_media_assets_storeId_createdAt_idx" ON "store_media_assets"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "store_media_assets_storeId_kind_idx" ON "store_media_assets"("storeId", "kind");

-- CreateIndex
CREATE INDEX "store_media_assets_storeId_folder_idx" ON "store_media_assets"("storeId", "folder");

-- CreateIndex
CREATE UNIQUE INDEX "store_media_assets_storeId_checksum_key" ON "store_media_assets"("storeId", "checksum");

-- AddForeignKey
ALTER TABLE "store_media_assets" ADD CONSTRAINT "store_media_assets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

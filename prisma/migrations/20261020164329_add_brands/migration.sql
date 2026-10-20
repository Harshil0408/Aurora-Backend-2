-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "logoUrl" VARCHAR(1024),
    "bannerUrl" VARCHAR(1024),
    "description" VARCHAR(2000),
    "website" VARCHAR(512),
    "country" VARCHAR(64),
    "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "mergedIntoId" VARCHAR(64),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_redirects" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_requests" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT,
    "name" VARCHAR(128) NOT NULL,
    "website" VARCHAR(512),
    "proofAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "justification" VARCHAR(1000) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(1000),
    "resolvedBrandId" TEXT,
    "reviewedById" VARCHAR(64),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_authorizations" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "documentAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(1000),
    "expiresAt" TIMESTAMP(3),
    "reviewedById" VARCHAR(64),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_status_idx" ON "brands"("status");

-- CreateIndex
CREATE INDEX "brands_featured_idx" ON "brands"("featured");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brand_redirects_slug_key" ON "brand_redirects"("slug");

-- CreateIndex
CREATE INDEX "brand_redirects_brandId_idx" ON "brand_redirects"("brandId");

-- CreateIndex
CREATE INDEX "brand_requests_storeId_status_idx" ON "brand_requests"("storeId", "status");

-- CreateIndex
CREATE INDEX "brand_requests_status_createdAt_idx" ON "brand_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "brand_authorizations_storeId_brandId_idx" ON "brand_authorizations"("storeId", "brandId");

-- CreateIndex
CREATE INDEX "brand_authorizations_brandId_status_idx" ON "brand_authorizations"("brandId", "status");

-- CreateIndex
CREATE INDEX "brand_authorizations_storeId_status_createdAt_idx" ON "brand_authorizations"("storeId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "brand_redirects" ADD CONSTRAINT "brand_redirects_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_resolvedBrandId_fkey" FOREIGN KEY ("resolvedBrandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_authorizations" ADD CONSTRAINT "brand_authorizations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_authorizations" ADD CONSTRAINT "brand_authorizations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

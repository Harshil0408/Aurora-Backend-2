-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "imageUrl" VARCHAR(1024),
    "bannerUrl" VARCHAR(1024),
    "icon" VARCHAR(64),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "showInNav" BOOLEAN NOT NULL DEFAULT true,
    "showOnHomepage" BOOLEAN NOT NULL DEFAULT false,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "metaTitle" VARCHAR(160),
    "metaDescription" VARCHAR(320),
    "canonicalUrl" VARCHAR(1024),
    "ogImageUrl" VARCHAR(1024),
    "attributeSetId" TEXT,
    "taxClassId" TEXT,
    "commissionRateBps" INTEGER,
    "returnWindowDays" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_redirects" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_requests" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT,
    "name" VARCHAR(128) NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "proposedParentId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(1000),
    "resolvedCategoryId" TEXT,
    "reviewedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_access_grants" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "documentAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(1000),
    "reviewedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_displayOrder_idx" ON "categories"("parentId", "displayOrder");

-- CreateIndex
CREATE INDEX "categories_status_idx" ON "categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "category_redirects_slug_key" ON "category_redirects"("slug");

-- CreateIndex
CREATE INDEX "category_redirects_categoryId_idx" ON "category_redirects"("categoryId");

-- CreateIndex
CREATE INDEX "category_requests_storeId_status_idx" ON "category_requests"("storeId", "status");

-- CreateIndex
CREATE INDEX "category_requests_status_createdAt_idx" ON "category_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "category_access_grants_storeId_categoryId_idx" ON "category_access_grants"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "category_access_grants_status_createdAt_idx" ON "category_access_grants"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_redirects" ADD CONSTRAINT "category_redirects_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_proposedParentId_fkey" FOREIGN KEY ("proposedParentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_access_grants" ADD CONSTRAINT "category_access_grants_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_access_grants" ADD CONSTRAINT "category_access_grants_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

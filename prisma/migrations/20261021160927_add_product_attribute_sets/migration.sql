-- CreateEnum
CREATE TYPE "ProductAttributeType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'BOOLEAN', 'DROPDOWN', 'MULTI_SELECT', 'COLOR_SWATCH', 'IMAGE_SWATCH', 'DATE');

-- CreateEnum
CREATE TYPE "ProductAttributeOptionStatus" AS ENUM ('SUGGESTED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProductCatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(160) NOT NULL,
    "type" "ProductAttributeType" NOT NULL DEFAULT 'TEXT',
    "unit" VARCHAR(32),
    "helpText" VARCHAR(500),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "searchable" BOOLEAN NOT NULL DEFAULT false,
    "comparable" BOOLEAN NOT NULL DEFAULT false,
    "variantDefining" BOOLEAN NOT NULL DEFAULT false,
    "visibleOnPage" BOOLEAN NOT NULL DEFAULT true,
    "validationMin" DOUBLE PRECISION,
    "validationMax" DOUBLE PRECISION,
    "validationRegex" VARCHAR(500),
    "allowedUnits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProductCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_options" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "value" VARCHAR(160) NOT NULL,
    "swatchHex" VARCHAR(16),
    "imageUrl" VARCHAR(1024),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductAttributeOptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "suggestedByStoreId" VARCHAR(64),
    "suggestedBySellerId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attribute_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_sets" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "status" "ProductCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attribute_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_groups" (
    "id" TEXT NOT NULL,
    "attributeSetId" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attribute_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_set_items" (
    "id" TEXT NOT NULL,
    "attributeSetId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "groupId" TEXT,
    "required" BOOLEAN,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attribute_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_attributes_code_key" ON "product_attributes"("code");

-- CreateIndex
CREATE INDEX "product_attributes_type_status_idx" ON "product_attributes"("type", "status");

-- CreateIndex
CREATE INDEX "product_attributes_status_createdAt_idx" ON "product_attributes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "product_attribute_options_attributeId_displayOrder_idx" ON "product_attribute_options"("attributeId", "displayOrder");

-- CreateIndex
CREATE INDEX "product_attribute_options_attributeId_status_idx" ON "product_attribute_options"("attributeId", "status");

-- CreateIndex
CREATE INDEX "product_attribute_options_status_createdAt_idx" ON "product_attribute_options"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_sets_slug_key" ON "product_attribute_sets"("slug");

-- CreateIndex
CREATE INDEX "product_attribute_sets_status_createdAt_idx" ON "product_attribute_sets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "product_attribute_groups_attributeSetId_displayOrder_idx" ON "product_attribute_groups"("attributeSetId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_groups_attributeSetId_name_key" ON "product_attribute_groups"("attributeSetId", "name");

-- CreateIndex
CREATE INDEX "product_attribute_set_items_attributeSetId_displayOrder_idx" ON "product_attribute_set_items"("attributeSetId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_set_items_attributeSetId_attributeId_key" ON "product_attribute_set_items"("attributeSetId", "attributeId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_attributeSetId_fkey" FOREIGN KEY ("attributeSetId") REFERENCES "product_attribute_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_options" ADD CONSTRAINT "product_attribute_options_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "product_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_groups" ADD CONSTRAINT "product_attribute_groups_attributeSetId_fkey" FOREIGN KEY ("attributeSetId") REFERENCES "product_attribute_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_set_items" ADD CONSTRAINT "product_attribute_set_items_attributeSetId_fkey" FOREIGN KEY ("attributeSetId") REFERENCES "product_attribute_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_set_items" ADD CONSTRAINT "product_attribute_set_items_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "product_attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_set_items" ADD CONSTRAINT "product_attribute_set_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_attribute_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

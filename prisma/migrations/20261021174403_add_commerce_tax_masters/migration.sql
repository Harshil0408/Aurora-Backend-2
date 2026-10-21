-- CreateEnum
CREATE TYPE "TaxClassStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HsnKind" AS ENUM ('HSN', 'SAC');

-- CreateEnum
CREATE TYPE "UnitDimension" AS ENUM ('MASS', 'LENGTH', 'VOLUME', 'QUANTITY');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'ROUND_HALF_UP', 'ROUND_UP_TO_RUPEE');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "priceIncludesTax" BOOLEAN;

-- CreateTable
CREATE TABLE "tax_classes" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(500),
    "status" "TaxClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "taxClassId" TEXT NOT NULL,
    "region" VARCHAR(8) NOT NULL DEFAULT 'ALL',
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "cessPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hsn_codes" (
    "id" TEXT NOT NULL,
    "kind" "HsnKind" NOT NULL DEFAULT 'HSN',
    "code" VARCHAR(8) NOT NULL,
    "description" VARCHAR(1000),
    "gstRatePercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "dimension" "UnitDimension" NOT NULL DEFAULT 'QUANTITY',
    "baseCode" VARCHAR(16) NOT NULL,
    "factor" DECIMAL(18,9) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "baseCurrency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "displayCurrency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'NONE',
    "updatedById" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_classes_name_key" ON "tax_classes"("name");

-- CreateIndex
CREATE INDEX "tax_classes_status_createdAt_idx" ON "tax_classes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "tax_rates_taxClassId_idx" ON "tax_rates"("taxClassId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_taxClassId_region_key" ON "tax_rates"("taxClassId", "region");

-- CreateIndex
CREATE UNIQUE INDEX "hsn_codes_code_key" ON "hsn_codes"("code");

-- CreateIndex
CREATE INDEX "hsn_codes_kind_idx" ON "hsn_codes"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_code_key" ON "units_of_measure"("code");

-- CreateIndex
CREATE INDEX "units_of_measure_dimension_idx" ON "units_of_measure"("dimension");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_taxClassId_fkey" FOREIGN KEY ("taxClassId") REFERENCES "tax_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_taxClassId_fkey" FOREIGN KEY ("taxClassId") REFERENCES "tax_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

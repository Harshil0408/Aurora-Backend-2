-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'PAYMENT_REQUIRED', 'PAUSED', 'CLOSED', 'DELETED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "seller_users" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailNormalized" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "passwordHash" VARCHAR(255) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "status" "SellerStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sessions" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "refreshTokenHash" VARCHAR(128) NOT NULL,
    "previousTokenHash" VARCHAR(128),
    "familyId" VARCHAR(64) NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" VARCHAR(128),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "logo" VARCHAR(512),
    "description" VARCHAR(1000),
    "category" VARCHAR(128),
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "ownerId" TEXT NOT NULL,
    "country" VARCHAR(64),
    "currency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "contactEmail" VARCHAR(255),
    "contactPhone" VARCHAR(32),
    "onboardingCompletedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_memberships" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedBy" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_roles" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(500),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_permissions" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "label" VARCHAR(128),
    "description" VARCHAR(500),
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "store_invitations" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailNormalized" VARCHAR(255) NOT NULL,
    "roleId" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_audit_log" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" VARCHAR(320),
    "action" VARCHAR(128) NOT NULL,
    "resourceType" VARCHAR(64) NOT NULL,
    "resourceId" VARCHAR(64),
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(500),
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "limits" JSONB,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_subscriptions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "provider" VARCHAR(64),
    "providerCustomerId" VARCHAR(128),
    "providerSubscriptionId" VARCHAR(128),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_users_email_key" ON "seller_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "seller_users_emailNormalized_key" ON "seller_users"("emailNormalized");

-- CreateIndex
CREATE INDEX "seller_users_status_idx" ON "seller_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_sessions_refreshTokenHash_key" ON "seller_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "seller_sessions_sellerId_idx" ON "seller_sessions"("sellerId");

-- CreateIndex
CREATE INDEX "seller_sessions_familyId_idx" ON "seller_sessions"("familyId");

-- CreateIndex
CREATE INDEX "seller_sessions_expiresAt_idx" ON "seller_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE INDEX "stores_ownerId_idx" ON "stores"("ownerId");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "stores"("status");

-- CreateIndex
CREATE INDEX "store_memberships_userId_idx" ON "store_memberships"("userId");

-- CreateIndex
CREATE INDEX "store_memberships_storeId_status_idx" ON "store_memberships"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_memberships_storeId_userId_key" ON "store_memberships"("storeId", "userId");

-- CreateIndex
CREATE INDEX "store_roles_storeId_status_idx" ON "store_roles"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_roles_storeId_key_key" ON "store_roles"("storeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "store_permissions_key_key" ON "store_permissions"("key");

-- CreateIndex
CREATE INDEX "store_permissions_resource_idx" ON "store_permissions"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "store_invitations_tokenHash_key" ON "store_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "store_invitations_storeId_status_idx" ON "store_invitations"("storeId", "status");

-- CreateIndex
CREATE INDEX "store_invitations_emailNormalized_idx" ON "store_invitations"("emailNormalized");

-- CreateIndex
CREATE INDEX "store_invitations_expiresAt_idx" ON "store_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "store_audit_log_storeId_createdAt_idx" ON "store_audit_log"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "store_audit_log_actorId_createdAt_idx" ON "store_audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "store_audit_log_action_createdAt_idx" ON "store_audit_log"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_key_key" ON "subscription_plans"("key");

-- CreateIndex
CREATE INDEX "store_subscriptions_storeId_status_idx" ON "store_subscriptions"("storeId", "status");

-- CreateIndex
CREATE INDEX "store_subscriptions_status_currentPeriodEnd_idx" ON "store_subscriptions"("status", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "seller_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "store_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_roles" ADD CONSTRAINT "store_roles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_role_permissions" ADD CONSTRAINT "store_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "store_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_role_permissions" ADD CONSTRAINT "store_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "store_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "store_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_audit_log" ADD CONSTRAINT "store_audit_log_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_audit_log" ADD CONSTRAINT "store_audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

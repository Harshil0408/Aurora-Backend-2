-- AlterTable
ALTER TABLE `admin_users` ADD COLUMN `emailOtpEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `emailOtpEnrolledAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `admin_email_otps` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `purpose` VARCHAR(32) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_email_otps_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `admin_email_otps_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_email_otps` ADD CONSTRAINT `admin_email_otps_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

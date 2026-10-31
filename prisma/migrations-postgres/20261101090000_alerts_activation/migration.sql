-- GoCardless sync lease, last sign-in, deleted-account emails (no repeat trials), throttled admin alerts.
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessSyncLockUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
CREATE TABLE "DeletedAccount" ("emailHash" TEXT NOT NULL, "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("emailHash"));
CREATE TABLE "PlatformAlert" ("key" TEXT NOT NULL, "sentAt" TIMESTAMP(3) NOT NULL, "suppressed" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "PlatformAlert_pkey" PRIMARY KEY ("key"));

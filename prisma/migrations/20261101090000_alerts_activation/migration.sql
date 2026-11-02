-- GoCardless sync lease, last sign-in, deleted-account emails (no repeat trials), throttled admin alerts.
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessSyncLockUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
CREATE TABLE "DeletedAccount" ("emailHash" TEXT NOT NULL PRIMARY KEY, "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PlatformAlert" ("key" TEXT NOT NULL PRIMARY KEY, "sentAt" DATETIME NOT NULL, "suppressed" INTEGER NOT NULL DEFAULT 0);

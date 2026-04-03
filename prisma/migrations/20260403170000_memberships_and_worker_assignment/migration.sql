CREATE TABLE "Membership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WORKER',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");
CREATE INDEX "Membership_tenantId_role_idx" ON "Membership"("tenantId", "role");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

ALTER TABLE "WorkDay" ADD COLUMN "assignedUserId" TEXT;
CREATE INDEX "WorkDay_tenantId_assignedUserId_idx" ON "WorkDay"("tenantId", "assignedUserId");

INSERT INTO "Membership" ("userId", "tenantId", "role", "permissions", "createdAt", "updatedAt")
SELECT
  "id",
  "tenantId",
  "role",
  CASE WHEN "role" = 'WORKER' THEN "workerPermissions" ELSE '[]' END,
  "createdAt",
  "updatedAt"
FROM "User"
WHERE "tenantId" IS NOT NULL;

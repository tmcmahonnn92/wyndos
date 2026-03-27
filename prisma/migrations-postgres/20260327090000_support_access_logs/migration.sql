CREATE TABLE "SupportAccessLog" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INTEGER NOT NULL,
  "superAdminUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "reason" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'SUPPORT_VIEW',
  "ipAddress" TEXT NOT NULL DEFAULT '',
  "userAgent" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "SupportAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "SupportAccessLog_superAdminUserId_fkey" FOREIGN KEY ("superAdminUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SupportAccessLog_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "SupportAccessLog_tenantId_idx" ON "SupportAccessLog"("tenantId");
CREATE INDEX "SupportAccessLog_superAdminUserId_idx" ON "SupportAccessLog"("superAdminUserId");
CREATE INDEX "SupportAccessLog_createdAt_idx" ON "SupportAccessLog"("createdAt");
CREATE INDEX "SupportAccessLog_endedAt_idx" ON "SupportAccessLog"("endedAt");

CREATE TABLE "OtherIncome" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "tenantId" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "source" TEXT NOT NULL DEFAULT '',
  "amount" REAL NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OtherIncome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OtherIncome_tenantId_idx" ON "OtherIncome"("tenantId");
CREATE INDEX "OtherIncome_tenantId_receivedAt_idx" ON "OtherIncome"("tenantId", "receivedAt");
CREATE INDEX "OtherIncome_tenantId_category_idx" ON "OtherIncome"("tenantId", "category");
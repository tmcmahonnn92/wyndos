CREATE TABLE "PaymentImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" DATETIME,
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0
);
CREATE INDEX "PaymentImport_tenantId_idx" ON "PaymentImport"("tenantId");
CREATE TABLE "ImportedLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "importId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "paymentId" INTEGER,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PaymentImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportedLine_tenantId_hash_key" ON "ImportedLine"("tenantId", "hash");
CREATE INDEX "ImportedLine_importId_idx" ON "ImportedLine"("importId");
CREATE TABLE "PayerReference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "customerId" INTEGER,
    "ignore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayerReference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayerReference_tenantId_key_key" ON "PayerReference"("tenantId", "key");
CREATE INDEX "PayerReference_tenantId_customerId_idx" ON "PayerReference"("tenantId", "customerId");

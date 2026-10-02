ALTER TABLE "TenantSettings" ADD COLUMN "allowCustomerCredit" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "CashHandover" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "workerUserId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CashHandover_tenantId_workerUserId_idx" ON "CashHandover"("tenantId", "workerUserId");
ALTER TABLE "Payment" ADD COLUMN "handoverId" INTEGER REFERENCES "CashHandover" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

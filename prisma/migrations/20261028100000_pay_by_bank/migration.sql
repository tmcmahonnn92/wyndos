-- Pay by Bank links (GoCardless instant bank payments) for a customer's cleans.
CREATE TABLE "PayByBankRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "billingRequestId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "jobIds" TEXT NOT NULL DEFAULT '[]',
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "goCardlessPaymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PayByBankRequest_billingRequestId_key" ON "PayByBankRequest"("billingRequestId");
CREATE INDEX "PayByBankRequest_tenantId_status_idx" ON "PayByBankRequest"("tenantId", "status");

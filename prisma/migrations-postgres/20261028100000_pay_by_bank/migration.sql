-- Pay by Bank links (GoCardless instant bank payments) for a customer's cleans.
CREATE TABLE "PayByBankRequest" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "billingRequestId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "jobIds" TEXT NOT NULL DEFAULT '[]',
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "goCardlessPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayByBankRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayByBankRequest_billingRequestId_key" ON "PayByBankRequest"("billingRequestId");
CREATE INDEX "PayByBankRequest_tenantId_status_idx" ON "PayByBankRequest"("tenantId", "status");

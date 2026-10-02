ALTER TABLE "TenantSettings" ADD COLUMN "allowCustomerCredit" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "CashHandover" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "workerUserId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashHandover_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashHandover_tenantId_workerUserId_idx" ON "CashHandover"("tenantId", "workerUserId");
ALTER TABLE "Payment" ADD COLUMN "handoverId" INTEGER;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "CashHandover"("id") ON DELETE SET NULL ON UPDATE CASCADE;

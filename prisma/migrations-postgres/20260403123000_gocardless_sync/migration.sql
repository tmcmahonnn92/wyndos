ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessAccessToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessEnvironment" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessReferencePrefix" TEXT NOT NULL DEFAULT 'WD';
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessLastSyncedAt" TIMESTAMP(3);

ALTER TABLE "Customer" ADD COLUMN "goCardlessCustomerReference" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "goCardlessCustomerId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "goCardlessMandateId" TEXT;

ALTER TABLE "Payment" ADD COLUMN "goCardlessPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "goCardlessStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN "goCardlessReference" TEXT;

CREATE INDEX "Customer_tenantId_goCardlessCustomerReference_idx" ON "Customer"("tenantId", "goCardlessCustomerReference");
CREATE UNIQUE INDEX "Payment_goCardlessPaymentId_key" ON "Payment"("goCardlessPaymentId");
CREATE INDEX "Payment_tenantId_goCardlessStatus_idx" ON "Payment"("tenantId", "goCardlessStatus");
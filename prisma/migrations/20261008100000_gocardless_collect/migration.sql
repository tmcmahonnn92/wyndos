-- GoCardless: collect per clean, sign-up links, mandate status, auto-collect.
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessCreditorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessAutoCollect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessAutoCollectFrom" DATETIME;
ALTER TABLE "TenantSettings" ADD COLUMN "goCardlessLastError" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "goCardlessMandateStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "goCardlessBillingRequestId" TEXT;
ALTER TABLE "Job" ADD COLUMN "goCardlessPaymentId" TEXT;
ALTER TABLE "Job" ADD COLUMN "goCardlessStatus" TEXT;
CREATE UNIQUE INDEX "Job_goCardlessPaymentId_key" ON "Job"("goCardlessPaymentId");

-- PaymentAllocation migration for PostgreSQL
-- Migrate existing job-linked payments to the new PaymentAllocation model
-- Add voidedAt / voidReason / updatedAt to Payment, drop jobId

-- Step 1: Add new columns to Payment
ALTER TABLE "Payment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Payment" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "voidReason" TEXT;

-- Step 2: Create PaymentAllocation table
CREATE TABLE "PaymentAllocation" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INTEGER NOT NULL,
  "paymentId" INTEGER NOT NULL,
  "jobId" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE,
  CONSTRAINT "PaymentAllocation_jobId_fkey"    FOREIGN KEY ("jobId")    REFERENCES "Job"("id") ON DELETE RESTRICT
);

-- Step 3: Migrate existing jobId-linked payments to PaymentAllocation
INSERT INTO "PaymentAllocation" ("tenantId", "paymentId", "jobId", "amount")
SELECT "tenantId", "id", "jobId", "amount"
FROM "Payment"
WHERE "jobId" IS NOT NULL;

-- Step 4: Drop the old jobId foreign key and column from Payment
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_jobId_fkey";
ALTER TABLE "Payment" DROP COLUMN "jobId";

-- Step 5: Drop old index that referenced jobId
DROP INDEX IF EXISTS "Payment_tenantId_jobId_idx";

-- Step 6: Add new indexes
CREATE INDEX "Payment_voidedAt_idx"                ON "Payment"("voidedAt");
CREATE INDEX "PaymentAllocation_tenantId_idx"       ON "PaymentAllocation"("tenantId");
CREATE INDEX "PaymentAllocation_paymentId_idx"      ON "PaymentAllocation"("paymentId");
CREATE INDEX "PaymentAllocation_jobId_idx"          ON "PaymentAllocation"("jobId");

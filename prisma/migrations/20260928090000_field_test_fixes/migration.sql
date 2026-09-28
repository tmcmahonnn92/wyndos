-- Field test fixes: per-job worker assignment, completion tracking,
-- payment collector + idempotency key, slips and "paid by" links.

ALTER TABLE "Job" ADD COLUMN "assignedUserId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD COLUMN "completedByUserId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Job_tenantId_assignedUserId_idx" ON "Job"("tenantId", "assignedUserId");
CREATE INDEX "Job_tenantId_completedByUserId_idx" ON "Job"("tenantId", "completedByUserId");

ALTER TABLE "Payment" ADD COLUMN "collectedByUserId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");

ALTER TABLE "Customer" ADD COLUMN "slip" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Customer" ADD COLUMN "paidByCustomerId" INTEGER REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

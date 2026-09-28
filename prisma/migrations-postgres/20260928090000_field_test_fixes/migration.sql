-- Field test fixes: per-job worker assignment, completion tracking,
-- payment collector + idempotency key, slips and "paid by" links.

ALTER TABLE "Job" ADD COLUMN "assignedUserId" TEXT,
ADD COLUMN "completedByUserId" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Job_tenantId_assignedUserId_idx" ON "Job"("tenantId", "assignedUserId");
CREATE INDEX "Job_tenantId_completedByUserId_idx" ON "Job"("tenantId", "completedByUserId");

ALTER TABLE "Payment" ADD COLUMN "collectedByUserId" TEXT,
ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");

ALTER TABLE "Customer" ADD COLUMN "slip" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "paidByCustomerId" INTEGER;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_paidByCustomerId_fkey" FOREIGN KEY ("paidByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote visits and prospect (not-yet-live) customers.
ALTER TABLE "Customer" ADD COLUMN "isProspect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "isQuote" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "quoteStatus" TEXT;
ALTER TABLE "Job" ADD COLUMN "quotedPrice" REAL;
ALTER TABLE "Job" ADD COLUMN "quotedFrequencyWeeks" INTEGER;
ALTER TABLE "Job" ADD COLUMN "quotedAt" DATETIME;
CREATE INDEX "Job_tenantId_isQuote_quoteStatus_idx" ON "Job"("tenantId", "isQuote", "quoteStatus");

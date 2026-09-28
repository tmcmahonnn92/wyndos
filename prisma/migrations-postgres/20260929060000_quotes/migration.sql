-- Quote visits and prospect (not-yet-live) customers.
ALTER TABLE "Customer" ADD COLUMN "isProspect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "isQuote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quoteStatus" TEXT,
ADD COLUMN "quotedPrice" DOUBLE PRECISION,
ADD COLUMN "quotedFrequencyWeeks" INTEGER,
ADD COLUMN "quotedAt" TIMESTAMP(3);
CREATE INDEX "Job_tenantId_isQuote_quoteStatus_idx" ON "Job"("tenantId", "isQuote", "quoteStatus");

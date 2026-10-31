-- Price calculator: price list per business, the workings behind a quote, and how long a clean takes.
ALTER TABLE "TenantSettings" ADD COLUMN "pricingConfig" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Job" ADD COLUMN "quoteCalc" TEXT;
ALTER TABLE "Customer" ADD COLUMN "cleanMinutes" INTEGER;

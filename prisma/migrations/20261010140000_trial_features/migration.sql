-- Features trialled with some businesses, and the first one: emailed invoices when a day is finished.
ALTER TABLE "Tenant" ADD COLUMN "trialFeatures" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TenantSettings" ADD COLUMN "autoInvoiceEmail" BOOLEAN NOT NULL DEFAULT false;

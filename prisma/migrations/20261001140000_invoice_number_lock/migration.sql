ALTER TABLE "TenantSettings" ADD COLUMN "invoiceNumbersStarted" BOOLEAN NOT NULL DEFAULT false;
-- Businesses that have already issued invoices keep their numbering locked.
UPDATE "TenantSettings" SET "invoiceNumbersStarted" = true WHERE "nextInvoiceNum" > 1;

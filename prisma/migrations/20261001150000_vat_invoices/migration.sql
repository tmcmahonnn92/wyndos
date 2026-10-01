ALTER TABLE "TenantSettings" ADD COLUMN "invoiceVatEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TenantSettings" ADD COLUMN "invoiceVatRate" REAL NOT NULL DEFAULT 20;
ALTER TABLE "TenantSettings" ADD COLUMN "invoicePaymentTerms" TEXT NOT NULL DEFAULT '';

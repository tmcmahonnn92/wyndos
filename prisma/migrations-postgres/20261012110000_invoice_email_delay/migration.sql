-- Delay before emailing invoices, and when auto invoices were switched on.
ALTER TABLE "TenantSettings" ADD COLUMN "autoInvoiceDelayMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TenantSettings" ADD COLUMN "autoInvoiceSince" TIMESTAMP(3);

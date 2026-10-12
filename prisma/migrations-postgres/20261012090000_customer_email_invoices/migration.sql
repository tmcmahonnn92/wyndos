-- Customers who get their invoices by email.
ALTER TABLE "Customer" ADD COLUMN "emailInvoices" BOOLEAN NOT NULL DEFAULT false;

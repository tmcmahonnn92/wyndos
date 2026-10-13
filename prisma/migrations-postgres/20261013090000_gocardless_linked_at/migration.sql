-- GoCardless: when a customer's Direct Debit was first seen, and any GoCardless plan (subscription) on it.
ALTER TABLE "Customer" ADD COLUMN "goCardlessLinkedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "goCardlessPlan" TEXT;
-- Customers already linked: only payments from now on are added by the sync.
UPDATE "Customer" SET "goCardlessLinkedAt" = CURRENT_TIMESTAMP WHERE "goCardlessMandateId" IS NOT NULL;

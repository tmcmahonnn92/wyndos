-- AlterTable: add jobName, advanceNotice, preferredPaymentMethod to Customer
ALTER TABLE "Customer" ADD COLUMN "jobName" TEXT NOT NULL DEFAULT 'Window Cleaning';
ALTER TABLE "Customer" ADD COLUMN "advanceNotice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "preferredPaymentMethod" TEXT NOT NULL DEFAULT '';

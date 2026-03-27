-- AlterTable: add skipNextAreaRun flag to Customer
-- Set when a customer is added as a one-off to another area's day and no home-area
-- scheduled run exists yet. Cleared automatically when the next home-area run is created.
ALTER TABLE "Customer" ADD COLUMN "skipNextAreaRun" BOOLEAN NOT NULL DEFAULT false;

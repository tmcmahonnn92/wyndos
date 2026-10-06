-- Order of work on a day: area order per date, today-only job placement, always-after links.
ALTER TABLE "WorkDay" ADD COLUMN "dayOrder" INTEGER;
ALTER TABLE "Job" ADD COLUMN "afterJobId" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "placeAfterCustomerId" INTEGER;

ALTER TABLE "Expense" ADD COLUMN "repeatEvery" INTEGER;
ALTER TABLE "Expense" ADD COLUMN "repeatUnit" TEXT;
ALTER TABLE "Expense" ADD COLUMN "repeatAnchorDate" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "nextScheduledAt" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "repeatEndsAt" DATETIME;

ALTER TABLE "OtherIncome" ADD COLUMN "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OtherIncome" ADD COLUMN "repeatEvery" INTEGER;
ALTER TABLE "OtherIncome" ADD COLUMN "repeatUnit" TEXT;
ALTER TABLE "OtherIncome" ADD COLUMN "repeatAnchorDate" DATETIME;
ALTER TABLE "OtherIncome" ADD COLUMN "nextScheduledAt" DATETIME;
ALTER TABLE "OtherIncome" ADD COLUMN "repeatEndsAt" DATETIME;
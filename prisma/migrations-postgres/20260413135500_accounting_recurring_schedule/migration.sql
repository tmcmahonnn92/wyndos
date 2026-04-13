ALTER TABLE "Expense"
ADD COLUMN "repeatEvery" INTEGER,
ADD COLUMN "repeatUnit" TEXT,
ADD COLUMN "repeatAnchorDate" TIMESTAMP(3),
ADD COLUMN "nextScheduledAt" TIMESTAMP(3),
ADD COLUMN "repeatEndsAt" TIMESTAMP(3);

ALTER TABLE "OtherIncome"
ADD COLUMN "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "repeatEvery" INTEGER,
ADD COLUMN "repeatUnit" TEXT,
ADD COLUMN "repeatAnchorDate" TIMESTAMP(3),
ADD COLUMN "nextScheduledAt" TIMESTAMP(3),
ADD COLUMN "repeatEndsAt" TIMESTAMP(3);
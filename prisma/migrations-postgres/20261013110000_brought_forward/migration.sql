-- Money carried over from another program on import: kept for balances, left out of income.
ALTER TABLE "Payment" ADD COLUMN "broughtForward" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "broughtForward" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Payment" SET "broughtForward" = true WHERE "notes" LIKE 'Credit brought forward from %';
UPDATE "Job" SET "broughtForward" = true WHERE "name" = 'Balance brought forward' AND "notes" LIKE 'Owed when moving from %';

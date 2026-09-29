-- An area run can be split across dates: extra days point at the run's main day.
ALTER TABLE "WorkDay" ADD COLUMN "partOfId" INTEGER;
CREATE INDEX "WorkDay_partOfId_idx" ON "WorkDay"("partOfId");

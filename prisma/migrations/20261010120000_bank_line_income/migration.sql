-- Bank lines saved as income from someone not in Wyndos.
ALTER TABLE "ImportedLine" ADD COLUMN "otherIncomeId" INTEGER;

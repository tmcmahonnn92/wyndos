ALTER TABLE "Expense"
ADD COLUMN "recurrenceTemplateId" INTEGER,
ADD COLUMN "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'NO_VAT';

CREATE INDEX "Expense_tenantId_recurrenceTemplateId_idx" ON "Expense"("tenantId", "recurrenceTemplateId");

ALTER TABLE "OtherIncome"
ADD COLUMN "recurrenceTemplateId" INTEGER,
ADD COLUMN "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'NO_VAT';

CREATE INDEX "OtherIncome_tenantId_recurrenceTemplateId_idx" ON "OtherIncome"("tenantId", "recurrenceTemplateId");
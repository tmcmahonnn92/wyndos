ALTER TABLE "Expense" ADD COLUMN "recurrenceTemplateId" INTEGER;
ALTER TABLE "Expense" ADD COLUMN "netAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "vatAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "vatRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'NO_VAT';
CREATE INDEX "Expense_tenantId_recurrenceTemplateId_idx" ON "Expense"("tenantId", "recurrenceTemplateId");

ALTER TABLE "OtherIncome" ADD COLUMN "recurrenceTemplateId" INTEGER;
ALTER TABLE "OtherIncome" ADD COLUMN "netAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OtherIncome" ADD COLUMN "vatAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OtherIncome" ADD COLUMN "vatRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OtherIncome" ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'NO_VAT';
CREATE INDEX "OtherIncome_tenantId_recurrenceTemplateId_idx" ON "OtherIncome"("tenantId", "recurrenceTemplateId");
/*
  Warnings:

  - You are about to drop the `PasskeyCredential` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `receiptFilename` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `receiptImage` on the `Expense` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "PasskeyCredential_userId_idx";

-- DropIndex
DROP INDEX "PasskeyCredential_credentialID_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PasskeyCredential";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "recurrenceTemplateId" INTEGER,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "hmrcCategory" TEXT NOT NULL DEFAULT 'OTHER',
    "supplier" TEXT NOT NULL DEFAULT '',
    "amount" REAL NOT NULL,
    "netAmount" REAL NOT NULL DEFAULT 0,
    "vatAmount" REAL NOT NULL DEFAULT 0,
    "vatRate" REAL NOT NULL DEFAULT 0,
    "taxTreatment" TEXT NOT NULL DEFAULT 'NO_VAT',
    "expenseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "repeatEvery" INTEGER,
    "repeatUnit" TEXT,
    "repeatAnchorDate" DATETIME,
    "nextScheduledAt" DATETIME,
    "repeatEndsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("amount", "category", "createdAt", "expenseDate", "hmrcCategory", "id", "isRecurring", "netAmount", "nextScheduledAt", "notes", "recurrenceTemplateId", "repeatAnchorDate", "repeatEndsAt", "repeatEvery", "repeatUnit", "supplier", "taxTreatment", "tenantId", "updatedAt", "vatAmount", "vatRate") SELECT "amount", "category", "createdAt", "expenseDate", "hmrcCategory", "id", "isRecurring", "netAmount", "nextScheduledAt", "notes", "recurrenceTemplateId", "repeatAnchorDate", "repeatEndsAt", "repeatEvery", "repeatUnit", "supplier", "taxTreatment", "tenantId", "updatedAt", "vatAmount", "vatRate" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE INDEX "Expense_tenantId_idx" ON "Expense"("tenantId");
CREATE INDEX "Expense_tenantId_expenseDate_idx" ON "Expense"("tenantId", "expenseDate");
CREATE INDEX "Expense_tenantId_category_idx" ON "Expense"("tenantId", "category");
CREATE INDEX "Expense_tenantId_recurrenceTemplateId_idx" ON "Expense"("tenantId", "recurrenceTemplateId");
CREATE TABLE "new_WorkDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "areaId" INTEGER,
    "assignedUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "routeOrderingMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "manualRouteOrder" TEXT,
    "optimizedRouteOrder" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkDay_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkDay_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkDay" ("areaId", "assignedUserId", "createdAt", "date", "id", "manualRouteOrder", "notes", "optimizedRouteOrder", "routeOrderingMode", "status", "tenantId") SELECT "areaId", "assignedUserId", "createdAt", "date", "id", "manualRouteOrder", "notes", "optimizedRouteOrder", "routeOrderingMode", "status", "tenantId" FROM "WorkDay";
DROP TABLE "WorkDay";
ALTER TABLE "new_WorkDay" RENAME TO "WorkDay";
CREATE INDEX "WorkDay_tenantId_idx" ON "WorkDay"("tenantId");
CREATE INDEX "WorkDay_tenantId_date_idx" ON "WorkDay"("tenantId", "date");
CREATE INDEX "WorkDay_tenantId_areaId_idx" ON "WorkDay"("tenantId", "areaId");
CREATE INDEX "WorkDay_tenantId_assignedUserId_idx" ON "WorkDay"("tenantId", "assignedUserId");
CREATE UNIQUE INDEX "WorkDay_tenantId_date_areaId_key" ON "WorkDay"("tenantId", "date", "areaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

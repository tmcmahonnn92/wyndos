-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Area" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scheduleType" TEXT NOT NULL DEFAULT 'WEEKLY',
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "monthlyDay" INTEGER,
    "nextDueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Area" ("createdAt", "frequencyWeeks", "id", "name", "nextDueDate", "sortOrder") SELECT "createdAt", "frequencyWeeks", "id", "name", "nextDueDate", "sortOrder" FROM "Area";
DROP TABLE "Area";
ALTER TABLE "new_Area" RENAME TO "Area";
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

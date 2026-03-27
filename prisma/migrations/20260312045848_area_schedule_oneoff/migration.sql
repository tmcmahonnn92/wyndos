-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Area" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "nextDueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Area" ("createdAt", "id", "name", "sortOrder") SELECT "createdAt", "id", "name", "sortOrder" FROM "Area";
DROP TABLE "Area";
ALTER TABLE "new_Area" RENAME TO "Area";
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workDayId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "price" REAL NOT NULL,
    "completedAt" DATETIME,
    "notes" TEXT,
    "isOneOff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_workDayId_fkey" FOREIGN KEY ("workDayId") REFERENCES "WorkDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("completedAt", "createdAt", "customerId", "id", "notes", "price", "status", "workDayId") SELECT "completedAt", "createdAt", "customerId", "id", "notes", "price", "status", "workDayId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

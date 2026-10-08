-- Accounts ready for Making Tax Digital: basis, quarters, private use, vehicles, mileage, use of home, assets, submitted quarters.
ALTER TABLE "TenantSettings" ADD COLUMN "accountingBasis" TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE "TenantSettings" ADD COLUMN "mtdPeriodType" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Expense" ADD COLUMN "businessPct" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Expense" ADD COLUMN "vehicleId" INTEGER;

CREATE TABLE "Vehicle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "registration" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'VAN',
    "method" TEXT NOT NULL DEFAULT 'ACTUAL',
    "businessPct" INTEGER NOT NULL DEFAULT 100,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");

CREATE TABLE "MileageTrip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "miles" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MileageTrip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MileageTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MileageTrip_tenantId_date_idx" ON "MileageTrip"("tenantId", "date");

CREATE TABLE "HomeUseMonth" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "month" DATETIME NOT NULL,
    "hours" INTEGER NOT NULL,
    CONSTRAINT "HomeUseMonth_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HomeUseMonth_tenantId_month_key" ON "HomeUseMonth"("tenantId", "month");

CREATE TABLE "BusinessAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "boughtAt" DATETIME NOT NULL,
    "cost" REAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EQUIPMENT',
    "carEmissions" TEXT,
    "businessPct" INTEGER NOT NULL DEFAULT 100,
    "disposedAt" DATETIME,
    "disposalValue" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BusinessAsset_tenantId_idx" ON "BusinessAsset"("tenantId");

CREATE TABLE "MtdQuarterLock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "snapshot" TEXT NOT NULL,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MtdQuarterLock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MtdQuarterLock_tenantId_periodStart_key" ON "MtdQuarterLock"("tenantId", "periodStart");

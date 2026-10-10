-- Accounts ready for Making Tax Digital: basis, quarters, private use, vehicles, mileage, use of home, assets, submitted quarters.
ALTER TABLE "TenantSettings" ADD COLUMN "accountingBasis" TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE "TenantSettings" ADD COLUMN "mtdPeriodType" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Expense" ADD COLUMN "businessPct" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Expense" ADD COLUMN "vehicleId" INTEGER;

CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "registration" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'VAN',
    "method" TEXT NOT NULL DEFAULT 'ACTUAL',
    "businessPct" INTEGER NOT NULL DEFAULT 100,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MileageTrip" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "miles" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MileageTrip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MileageTrip_tenantId_date_idx" ON "MileageTrip"("tenantId", "date");
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HomeUseMonth" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "hours" INTEGER NOT NULL,
    CONSTRAINT "HomeUseMonth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HomeUseMonth_tenantId_month_key" ON "HomeUseMonth"("tenantId", "month");
ALTER TABLE "HomeUseMonth" ADD CONSTRAINT "HomeUseMonth_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BusinessAsset" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "boughtAt" TIMESTAMP(3) NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EQUIPMENT',
    "carEmissions" TEXT,
    "businessPct" INTEGER NOT NULL DEFAULT 100,
    "disposedAt" TIMESTAMP(3),
    "disposalValue" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BusinessAsset_tenantId_idx" ON "BusinessAsset"("tenantId");
ALTER TABLE "BusinessAsset" ADD CONSTRAINT "BusinessAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MtdQuarterLock" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "snapshot" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MtdQuarterLock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MtdQuarterLock_tenantId_periodStart_key" ON "MtdQuarterLock"("tenantId", "periodStart");
ALTER TABLE "MtdQuarterLock" ADD CONSTRAINT "MtdQuarterLock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

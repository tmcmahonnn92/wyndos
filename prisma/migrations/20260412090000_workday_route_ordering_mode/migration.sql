ALTER TABLE "WorkDay" ADD COLUMN "routeOrderingMode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "WorkDay" ADD COLUMN "manualRouteOrder" TEXT;
ALTER TABLE "WorkDay" ADD COLUMN "optimizedRouteOrder" TEXT;
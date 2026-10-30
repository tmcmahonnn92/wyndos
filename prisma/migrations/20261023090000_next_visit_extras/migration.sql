-- Extra jobs asked for at the next visit, added when that visit is booked.
ALTER TABLE "Customer" ADD COLUMN "nextVisitExtras" TEXT NOT NULL DEFAULT '[]';

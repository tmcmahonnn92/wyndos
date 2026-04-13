CREATE TABLE "OtherIncome" (
  "id" SERIAL NOT NULL,
  "tenantId" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "source" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OtherIncome"
ADD CONSTRAINT "OtherIncome_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "OtherIncome_tenantId_idx" ON "OtherIncome"("tenantId");
CREATE INDEX "OtherIncome_tenantId_receivedAt_idx" ON "OtherIncome"("tenantId", "receivedAt");
CREATE INDEX "OtherIncome_tenantId_category_idx" ON "OtherIncome"("tenantId", "category");
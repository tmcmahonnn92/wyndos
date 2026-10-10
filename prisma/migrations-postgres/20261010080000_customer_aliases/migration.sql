-- Other names / addresses / references a customer is known by in imported files.
CREATE TABLE "CustomerAlias" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAlias_tenantId_kind_value_key" ON "CustomerAlias"("tenantId", "kind", "value");
CREATE INDEX "CustomerAlias_customerId_idx" ON "CustomerAlias"("customerId");
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

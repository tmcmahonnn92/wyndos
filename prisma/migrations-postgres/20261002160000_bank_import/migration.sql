CREATE TABLE "PaymentImport" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "PaymentImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentImport_tenantId_idx" ON "PaymentImport"("tenantId");
CREATE TABLE "ImportedLine" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "importId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "paymentId" INTEGER,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportedLine_tenantId_hash_key" ON "ImportedLine"("tenantId", "hash");
CREATE INDEX "ImportedLine_importId_idx" ON "ImportedLine"("importId");
ALTER TABLE "ImportedLine" ADD CONSTRAINT "ImportedLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PaymentImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "PayerReference" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "customerId" INTEGER,
    "ignore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayerReference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayerReference_tenantId_key_key" ON "PayerReference"("tenantId", "key");
CREATE INDEX "PayerReference_tenantId_customerId_idx" ON "PayerReference"("tenantId", "customerId");
ALTER TABLE "PayerReference" ADD CONSTRAINT "PayerReference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

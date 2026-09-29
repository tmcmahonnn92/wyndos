-- Automatic texts (test mode by default) and a log of every text.
ALTER TABLE "TenantSettings" ADD COLUMN "tmplCleanedBank" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, your windows at {{customerAddress}} have been cleaned today. {{amountDue}} is due. To pay by bank: {{bankDetails}}. Please use {{paymentReference}} as the reference. Thanks, {{businessName}}',
ADD COLUMN "textsTestMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "textCleanedEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "textSkipCleanedIfPaid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "textPaymentReminderDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "textPaymentReminder2Days" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "MessageLog" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "jobId" INTEGER,
    "workDayId" INTEGER,
    "kind" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessageLog_tenantId_createdAt_idx" ON "MessageLog"("tenantId", "createdAt");
CREATE INDEX "MessageLog_tenantId_kind_customerId_idx" ON "MessageLog"("tenantId", "kind", "customerId");
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Fix a garbled character in the old default 2nd payment reminder.
UPDATE "TenantSettings" SET "tmplPaymentReminder2" = REPLACE("tmplPaymentReminder2", 'ï¿½', '-');
ALTER TABLE "TenantSettings" ALTER COLUMN "tmplPaymentReminder2" SET DEFAULT 'Hi {{customerFirstName}}, this is a second reminder - your window cleaning balance of {{amountDue}} is overdue. Please arrange payment as soon as possible. Thanks, {{businessName}}';

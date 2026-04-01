/*
  Warnings:

  - You are about to drop the column `jobId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `areaId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `User` table. All the data in the column will be lost.
  - Added the required column `tenantId` to the `Area` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `WorkDay` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Tenant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TenantSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "businessName" TEXT NOT NULL DEFAULT 'My Window Cleaning',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "bankDetails" TEXT NOT NULL DEFAULT '',
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "nextInvoiceNum" INTEGER NOT NULL DEFAULT 1,
    "logoBase64" TEXT,
    "smtpProvider" TEXT NOT NULL DEFAULT 'gmail',
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpPass" TEXT NOT NULL DEFAULT '',
    "smtpFromName" TEXT NOT NULL DEFAULT '',
    "messagingProvider" TEXT NOT NULL DEFAULT 'voodoosms',
    "voodooApiKey" TEXT NOT NULL DEFAULT '',
    "voodooSender" TEXT NOT NULL DEFAULT 'VoodooSMS',
    "twilioAccountSid" TEXT NOT NULL DEFAULT '',
    "twilioAuthToken" TEXT NOT NULL DEFAULT '',
    "twilioFromNumber" TEXT NOT NULL DEFAULT '',
    "metaPhoneNumberId" TEXT NOT NULL DEFAULT '',
    "metaAccessToken" TEXT NOT NULL DEFAULT '',
    "metaWabaId" TEXT NOT NULL DEFAULT '',
    "tmplCleaningReminder" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, just a reminder your window cleaning is scheduled for {{jobDate}}. Thanks, {{businessName}}',
    "tmplJobComplete" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, your window cleaning has been completed today. Thanks for your custom! {{businessName}}',
    "tmplPaymentReminder1" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, just a friendly reminder you have an outstanding balance of {{amountDue}} for window cleaning. Please arrange payment at your convenience. Thanks, {{businessName}}',
    "tmplPaymentReminder2" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, this is a second reminder ï¿½ your window cleaning balance of {{amountDue}} is overdue. Please arrange payment as soon as possible. Thanks, {{businessName}}',
    "tmplPaymentReminder3" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, this is a final reminder regarding your outstanding balance of {{amountDue}}. Please contact us immediately. {{businessName}}',
    "tmplPaymentReceived" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, we have received your payment of {{amountDue}}. Thank you! {{businessName}}',
    "tmplJobAndPayment" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, your window cleaning is complete and you have an outstanding balance of {{amountDue}}. Please arrange payment at your convenience. Thanks, {{businessName}}',
    "tmplInvoiceNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WORKER',
    "permissions" TEXT NOT NULL DEFAULT '["schedule"]',
    "tenantId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "customerId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    PRIMARY KEY ("customerId", "tagId"),
    CONSTRAINT "CustomerTag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "jobId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Holiday',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Migrate existing jobId-linked payments to PaymentAllocation before redefinition
-- This preserves historical payment→job relationships as proper allocations
INSERT INTO "PaymentAllocation" ("tenantId", "paymentId", "jobId", "amount")
SELECT "tenantId", "id", "jobId", "amount"
FROM "Payment"
WHERE "jobId" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Area" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scheduleType" TEXT NOT NULL DEFAULT 'WEEKLY',
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "monthlyDay" INTEGER,
    "nextDueDate" DATETIME,
    "lastCompletedDate" DATETIME,
    "isSystemArea" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Area_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Area" ("createdAt", "frequencyWeeks", "id", "monthlyDay", "name", "nextDueDate", "scheduleType", "sortOrder") SELECT "createdAt", "frequencyWeeks", "id", "monthlyDay", "name", "nextDueDate", "scheduleType", "sortOrder" FROM "Area";
DROP TABLE "Area";
ALTER TABLE "new_Area" RENAME TO "Area";
CREATE INDEX "Area_tenantId_idx" ON "Area"("tenantId");
CREATE INDEX "Area_tenantId_nextDueDate_idx" ON "Area"("tenantId", "nextDueDate");
CREATE UNIQUE INDEX "Area_tenantId_name_key" ON "Area"("tenantId", "name");
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "areaId" INTEGER NOT NULL,
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "price" REAL NOT NULL,
    "notes" TEXT,
    "jobName" TEXT NOT NULL DEFAULT 'Window Cleaning',
    "advanceNotice" BOOLEAN NOT NULL DEFAULT false,
    "preferredPaymentMethod" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nextDueDate" DATETIME,
    "lastCompletedDate" DATETIME,
    "skipNextAreaRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Customer_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("active", "address", "advanceNotice", "areaId", "createdAt", "frequencyWeeks", "id", "jobName", "lastCompletedDate", "name", "nextDueDate", "notes", "preferredPaymentMethod", "price", "skipNextAreaRun") SELECT "active", "address", "advanceNotice", "areaId", "createdAt", "frequencyWeeks", "id", "jobName", "lastCompletedDate", "name", "nextDueDate", "notes", "preferredPaymentMethod", "price", "skipNextAreaRun" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX "Customer_tenantId_areaId_idx" ON "Customer"("tenantId", "areaId");
CREATE INDEX "Customer_tenantId_active_idx" ON "Customer"("tenantId", "active");
CREATE INDEX "Customer_tenantId_nextDueDate_idx" ON "Customer"("tenantId", "nextDueDate");
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "workDayId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Window Cleaning',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "price" REAL NOT NULL,
    "completedAt" DATETIME,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isOneOff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_workDayId_fkey" FOREIGN KEY ("workDayId") REFERENCES "WorkDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("completedAt", "createdAt", "customerId", "id", "isOneOff", "notes", "price", "status", "workDayId") SELECT "completedAt", "createdAt", "customerId", "id", "isOneOff", "notes", "price", "status", "workDayId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");
CREATE INDEX "Job_tenantId_workDayId_idx" ON "Job"("tenantId", "workDayId");
CREATE INDEX "Job_tenantId_customerId_idx" ON "Job"("tenantId", "customerId");
CREATE INDEX "Job_tenantId_status_idx" ON "Job"("tenantId", "status");
CREATE INDEX "Job_completedAt_idx" ON "Job"("completedAt");
CREATE TABLE "new_Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "createdAt", "customerId", "id", "method", "notes", "paidAt") SELECT "amount", "createdAt", "customerId", "id", "method", "notes", "paidAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");
CREATE INDEX "Payment_tenantId_customerId_idx" ON "Payment"("tenantId", "customerId");
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");
CREATE TABLE "new_SupportAccessLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "superAdminUserId" TEXT NOT NULL,
    "endedByUserId" TEXT,
    "reason" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SUPPORT_VIEW',
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "SupportAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportAccessLog_superAdminUserId_fkey" FOREIGN KEY ("superAdminUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportAccessLog_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SupportAccessLog" ("createdAt", "endedAt", "endedByUserId", "id", "ipAddress", "reason", "scope", "superAdminUserId", "tenantId", "userAgent") SELECT "createdAt", "endedAt", "endedByUserId", "id", "ipAddress", "reason", "scope", "superAdminUserId", "tenantId", "userAgent" FROM "SupportAccessLog";
DROP TABLE "SupportAccessLog";
ALTER TABLE "new_SupportAccessLog" RENAME TO "SupportAccessLog";
CREATE INDEX "SupportAccessLog_tenantId_idx" ON "SupportAccessLog"("tenantId");
CREATE INDEX "SupportAccessLog_superAdminUserId_idx" ON "SupportAccessLog"("superAdminUserId");
CREATE INDEX "SupportAccessLog_createdAt_idx" ON "SupportAccessLog"("createdAt");
CREATE INDEX "SupportAccessLog_endedAt_idx" ON "SupportAccessLog"("endedAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "tenantId" INTEGER,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "workerPermissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "name", "onboardingComplete", "passwordHash", "role", "updatedAt") SELECT "createdAt", "email", "emailVerified", "id", "image", "name", "onboardingComplete", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE TABLE "new_WorkDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "areaId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkDay_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkDay" ("areaId", "createdAt", "date", "id", "notes", "status") SELECT "areaId", "createdAt", "date", "id", "notes", "status" FROM "WorkDay";
DROP TABLE "WorkDay";
ALTER TABLE "new_WorkDay" RENAME TO "WorkDay";
CREATE INDEX "WorkDay_tenantId_idx" ON "WorkDay"("tenantId");
CREATE INDEX "WorkDay_tenantId_date_idx" ON "WorkDay"("tenantId", "date");
CREATE INDEX "WorkDay_tenantId_areaId_idx" ON "WorkDay"("tenantId", "areaId");
CREATE UNIQUE INDEX "WorkDay_tenantId_date_areaId_key" ON "WorkDay"("tenantId", "date", "areaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_tenantId_idx" ON "Invite"("tenantId");

-- CreateIndex
CREATE INDEX "Invite_tenantId_email_idx" ON "Invite"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_name_key" ON "Tag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PaymentAllocation_tenantId_idx" ON "PaymentAllocation"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_jobId_idx" ON "PaymentAllocation"("jobId");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_idx" ON "Holiday"("tenantId");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_startDate_idx" ON "Holiday"("tenantId", "startDate");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_endDate_idx" ON "Holiday"("tenantId", "endDate");

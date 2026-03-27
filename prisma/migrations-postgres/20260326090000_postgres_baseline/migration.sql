-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OWNER', 'WORKER');

-- CreateEnum
CREATE TYPE "WorkDayStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'COMPLETE', 'SKIPPED', 'MOVED', 'OUTSTANDING');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BACS', 'CARD');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSettings" (
    "id" SERIAL NOT NULL,
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
    "tmplPaymentReminder2" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, this is a second reminder � your window cleaning balance of {{amountDue}} is overdue. Please arrange payment as soon as possible. Thanks, {{businessName}}',
    "tmplPaymentReminder3" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, this is a final reminder regarding your outstanding balance of {{amountDue}}. Please contact us immediately. {{businessName}}',
    "tmplPaymentReceived" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, we have received your payment of {{amountDue}}. Thank you! {{businessName}}',
    "tmplJobAndPayment" TEXT NOT NULL DEFAULT 'Hi {{customerFirstName}}, your window cleaning is complete and you have an outstanding balance of {{amountDue}}. Please arrange payment at your convenience. Thanks, {{businessName}}',
    "tmplInvoiceNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'WORKER',
    "permissions" TEXT NOT NULL DEFAULT '["schedule"]',
    "tenantId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "tenantId" INTEGER,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "workerPermissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scheduleType" TEXT NOT NULL DEFAULT 'WEEKLY',
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "monthlyDay" INTEGER,
    "nextDueDate" TIMESTAMP(3),
    "lastCompletedDate" TIMESTAMP(3),
    "isSystemArea" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "customerId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("customerId","tagId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "areaId" INTEGER NOT NULL,
    "frequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "price" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "jobName" TEXT NOT NULL DEFAULT 'Window Cleaning',
    "advanceNotice" BOOLEAN NOT NULL DEFAULT false,
    "preferredPaymentMethod" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nextDueDate" TIMESTAMP(3),
    "lastCompletedDate" TIMESTAMP(3),
    "skipNextAreaRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkDay" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "areaId" INTEGER,
    "status" "WorkDayStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "workDayId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Window Cleaning',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "price" DOUBLE PRECISION NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isOneOff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "jobId" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Holiday',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "Area_tenantId_idx" ON "Area"("tenantId");

-- CreateIndex
CREATE INDEX "Area_tenantId_nextDueDate_idx" ON "Area"("tenantId", "nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Area_tenantId_name_key" ON "Area"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_name_key" ON "Tag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_areaId_idx" ON "Customer"("tenantId", "areaId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_active_idx" ON "Customer"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Customer_tenantId_nextDueDate_idx" ON "Customer"("tenantId", "nextDueDate");

-- CreateIndex
CREATE INDEX "WorkDay_tenantId_idx" ON "WorkDay"("tenantId");

-- CreateIndex
CREATE INDEX "WorkDay_tenantId_date_idx" ON "WorkDay"("tenantId", "date");

-- CreateIndex
CREATE INDEX "WorkDay_tenantId_areaId_idx" ON "WorkDay"("tenantId", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkDay_tenantId_date_areaId_key" ON "WorkDay"("tenantId", "date", "areaId");

-- CreateIndex
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");

-- CreateIndex
CREATE INDEX "Job_tenantId_workDayId_idx" ON "Job"("tenantId", "workDayId");

-- CreateIndex
CREATE INDEX "Job_tenantId_customerId_idx" ON "Job"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Job_tenantId_status_idx" ON "Job"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Job_completedAt_idx" ON "Job"("completedAt");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_customerId_idx" ON "Payment"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_jobId_idx" ON "Payment"("tenantId", "jobId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_idx" ON "Holiday"("tenantId");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_startDate_idx" ON "Holiday"("tenantId", "startDate");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_endDate_idx" ON "Holiday"("tenantId", "endDate");

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_workDayId_fkey" FOREIGN KEY ("workDayId") REFERENCES "WorkDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


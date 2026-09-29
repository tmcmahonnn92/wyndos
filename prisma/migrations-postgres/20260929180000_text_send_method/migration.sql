-- Send texts from the user's own phone (default) or via VoodooSMS.
ALTER TABLE "TenantSettings" ADD COLUMN "textSendMethod" TEXT NOT NULL DEFAULT 'PHONE';
CREATE INDEX "MessageLog_tenantId_status_idx" ON "MessageLog"("tenantId", "status");

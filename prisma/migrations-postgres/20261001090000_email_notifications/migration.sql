-- Email notifications: per-person preferences and a short-delay queue.
ALTER TABLE "Membership" ADD COLUMN "notifyPrefs" TEXT NOT NULL DEFAULT '{}';
CREATE TABLE "NotificationEvent" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "workDayId" INTEGER,
    "userId" TEXT,
    "jobIds" TEXT NOT NULL DEFAULT '[]',
    "actorUserId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "skipped" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationEvent_sentAt_dueAt_idx" ON "NotificationEvent"("sentAt", "dueAt");
CREATE INDEX "NotificationEvent_tenantId_idx" ON "NotificationEvent"("tenantId");

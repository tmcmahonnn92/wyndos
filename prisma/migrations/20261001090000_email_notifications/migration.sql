-- Email notifications: per-person preferences and a short-delay queue.
ALTER TABLE "Membership" ADD COLUMN "notifyPrefs" TEXT NOT NULL DEFAULT '{}';
CREATE TABLE "NotificationEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "workDayId" INTEGER,
    "userId" TEXT,
    "jobIds" TEXT NOT NULL DEFAULT '[]',
    "actorUserId" TEXT,
    "dueAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "skipped" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NotificationEvent_sentAt_dueAt_idx" ON "NotificationEvent"("sentAt", "dueAt");
CREATE INDEX "NotificationEvent_tenantId_idx" ON "NotificationEvent"("tenantId");

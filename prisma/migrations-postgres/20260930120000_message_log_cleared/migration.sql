-- Texts cleared from the log stay hidden (still used so nothing is sent twice).
ALTER TABLE "MessageLog" ADD COLUMN "clearedAt" TIMESTAMP(3);

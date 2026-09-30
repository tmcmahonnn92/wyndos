-- A run includes customers due up to N days after it (business default + per-area override).
ALTER TABLE "TenantSettings" ADD COLUMN "runDueWindowDays" INTEGER;
ALTER TABLE "Area" ADD COLUMN "dueWindowDays" INTEGER;

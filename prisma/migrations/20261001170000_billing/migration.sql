ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" DATETIME;
ALTER TABLE "Tenant" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "currentPeriodEnd" DATETIME;
ALTER TABLE "Tenant" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");
-- Everyone already using Wyndos before billing keeps it free.
UPDATE "Tenant" SET "billingExempt" = true;

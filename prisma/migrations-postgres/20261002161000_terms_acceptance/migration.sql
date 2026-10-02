ALTER TABLE "Tenant" ADD COLUMN "termsVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "termsAcceptedByUserId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "dataPermissionAcceptedAt" TIMESTAMP(3);

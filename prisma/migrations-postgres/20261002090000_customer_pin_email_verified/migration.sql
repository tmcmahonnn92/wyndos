ALTER TABLE "Customer" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "longitude" DOUBLE PRECISION;
-- Everyone who signed up before email checks counts as confirmed.
UPDATE "User" SET "emailVerified" = "createdAt" WHERE "emailVerified" IS NULL;

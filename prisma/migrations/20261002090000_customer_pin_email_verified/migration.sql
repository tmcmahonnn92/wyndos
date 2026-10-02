ALTER TABLE "Customer" ADD COLUMN "latitude" REAL;
ALTER TABLE "Customer" ADD COLUMN "longitude" REAL;
-- Everyone who signed up before email checks counts as confirmed.
UPDATE "User" SET "emailVerified" = "createdAt" WHERE "emailVerified" IS NULL;

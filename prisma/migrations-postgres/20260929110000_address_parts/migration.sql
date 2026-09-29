-- One address, stored as parts so a day can be sorted by street and house number.
ALTER TABLE "Customer" ADD COLUMN "houseNameNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "street" TEXT NOT NULL DEFAULT '',
ADD COLUMN "town" TEXT NOT NULL DEFAULT '',
ADD COLUMN "postcode" TEXT NOT NULL DEFAULT '';

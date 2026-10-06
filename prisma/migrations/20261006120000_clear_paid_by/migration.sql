-- "Paid by another customer" was removed: clear any links so nobody is left tied to a payer.
UPDATE "Customer" SET "paidByCustomerId" = NULL WHERE "paidByCustomerId" IS NOT NULL;

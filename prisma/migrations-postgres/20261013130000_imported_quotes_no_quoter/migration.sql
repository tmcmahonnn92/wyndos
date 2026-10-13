-- Imported quotes were marked as quoted by whoever ran the import.
UPDATE "Job" SET "completedByUserId" = NULL WHERE "isQuote" = true AND "notes" = 'Imported quote';

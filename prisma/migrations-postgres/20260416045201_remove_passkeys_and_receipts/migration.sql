-- DropIndex
DROP INDEX IF EXISTS "PasskeyCredential_userId_idx";

-- DropIndex
DROP INDEX IF EXISTS "PasskeyCredential_credentialID_key";

-- DropTable
DROP TABLE IF EXISTS "PasskeyCredential";

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN IF EXISTS "receiptImage",
DROP COLUMN IF EXISTS "receiptFilename";

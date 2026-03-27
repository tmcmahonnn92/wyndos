import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "dev.db");

const db = new Database(dbPath);

try {
  db.exec('ALTER TABLE "Area" ADD COLUMN "isSystemArea" BOOLEAN NOT NULL DEFAULT false');
  console.log("✓ Added isSystemArea column");
} catch (e) {
  if (e.message.includes("duplicate column")) {
    console.log("Column already exists, skipping.");
  } else {
    throw e;
  }
}

db.close();

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const migrationDir = path.join(process.cwd(), "prisma", "migrations-postgres", "20260326090000_postgres_baseline");
fs.mkdirSync(migrationDir, { recursive: true });
const sql = execSync("npx prisma migrate diff --config prisma.config.postgres.ts --from-empty --to-schema prisma/schema.postgres.prisma --script", {
  cwd: process.cwd(),
  encoding: "utf8",
});
fs.writeFileSync(path.join(migrationDir, "migration.sql"), sql);
console.log("PostgreSQL baseline migration written.");

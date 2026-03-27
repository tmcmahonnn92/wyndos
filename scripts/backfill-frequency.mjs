import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import Database from "better-sqlite3";
import { PrismaLibSQL as _unused } from "@prisma/adapter-libsql";

// Use better-sqlite3 adapter directly like the app does
import { BetterSqlite3Adapter } from "@prisma/adapter-better-sqlite3";

const db = new Database("./dev.db");
const adapter = new BetterSqlite3Adapter(db);
const prisma = new PrismaClient({ adapter });

const result = await prisma.area.updateMany({
  where: { frequencyWeeks: null },
  data: { frequencyWeeks: 4 },
});

console.log(`Updated ${result.count} area rows with null frequencyWeeks → 4`);
await prisma.$disconnect();

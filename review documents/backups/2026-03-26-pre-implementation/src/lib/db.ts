import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const adapter = new PrismaBetterSqlite3({
  url: path.resolve(process.cwd(), "dev.db"),
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

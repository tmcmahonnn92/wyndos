import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma/client";
import { PrismaClient as PostgresPrismaClient } from "@/generated/prisma-postgres/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "path";

function resolveDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "file:./dev.db";
}

function isSqliteUrl(databaseUrl: string) {
  return databaseUrl.startsWith("file:") || databaseUrl.endsWith(".db") || databaseUrl.endsWith(".sqlite");
}

function resolveSqlitePath(databaseUrl: string) {
  const normalized = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
  const withoutQuery = normalized.split("?")[0].split("#")[0];
  return path.isAbsolute(withoutQuery) ? withoutQuery : path.resolve(process.cwd(), withoutQuery);
}

function createPrismaClient() {
  const databaseUrl = resolveDatabaseUrl();
  if (isSqliteUrl(databaseUrl)) {
    const adapter = new PrismaBetterSqlite3({
      url: resolveSqlitePath(databaseUrl),
    });
    return new SqlitePrismaClient({ adapter } as ConstructorParameters<typeof SqlitePrismaClient>[0]);
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PostgresPrismaClient({ adapter } as ConstructorParameters<typeof PostgresPrismaClient>[0]) as unknown as SqlitePrismaClient;
}

type AppPrismaClient = SqlitePrismaClient;
const globalForPrisma = globalThis as unknown as { prisma: AppPrismaClient | undefined };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;



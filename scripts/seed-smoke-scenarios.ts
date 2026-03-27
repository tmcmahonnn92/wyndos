import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hash } from "bcryptjs";
import { addDays, format } from "date-fns";
import fs from "node:fs";
import path from "node:path";

function resolveDatabaseUrl() {
  const smokeDatabaseUrl = process.env.SMOKE_DATABASE_URL?.trim();
  if (smokeDatabaseUrl) return smokeDatabaseUrl;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return "file:./dev.db";
  return isSqliteUrl(databaseUrl) ? databaseUrl : "file:./dev.db";
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
    return new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: resolveSqlitePath(databaseUrl) }),
    } as ConstructorParameters<typeof PrismaClient>[0]);
  }

  return new PrismaClient({} as ConstructorParameters<typeof PrismaClient>[0]);
}

const prisma = createPrismaClient();
const SMOKE_PASSWORD = "SmokeTest123!";

type SmokeTenantConfig = {
  slug: string;
  tenantName: string;
  ownerName: string;
  ownerEmail: string;
  areaName: string;
  customerName: string;
  customerAddress: string;
};

async function resetTenantBusinessData(tenantId: number) {
  await prisma.customerTag.deleteMany({ where: { customer: { tenantId } } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.job.deleteMany({ where: { tenantId } });
  await prisma.workDay.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.area.deleteMany({ where: { tenantId } });
  await prisma.tag.deleteMany({ where: { tenantId } });
  await prisma.holiday.deleteMany({ where: { tenantId } });
  await prisma.invite.deleteMany({ where: { tenantId } });
}

async function upsertSmokeTenant(config: SmokeTenantConfig, includePastWorkDay: boolean) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: config.slug },
    update: { name: config.tenantName },
    create: {
      slug: config.slug,
      name: config.tenantName,
    },
  });

  await resetTenantBusinessData(tenant.id);

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: {
      businessName: config.tenantName,
      ownerName: config.ownerName,
    },
    create: {
      tenantId: tenant.id,
      businessName: config.tenantName,
      ownerName: config.ownerName,
    },
  });

  const passwordHash = await hash(SMOKE_PASSWORD, 12);
  const existingUser = await prisma.user.findUnique({ where: { email: config.ownerEmail } });
  if (existingUser) {
    await prisma.session.deleteMany({ where: { userId: existingUser.id } });
    await prisma.account.deleteMany({ where: { userId: existingUser.id } });
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: config.ownerName,
        passwordHash,
        role: "OWNER",
        tenantId: tenant.id,
        onboardingComplete: true,
        workerPermissions: "[]",
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name: config.ownerName,
        email: config.ownerEmail,
        passwordHash,
        role: "OWNER",
        tenantId: tenant.id,
        onboardingComplete: true,
      },
    });
  }

  const area = await prisma.area.create({
    data: {
      tenantId: tenant.id,
      name: config.areaName,
      color: "#2563EB",
      sortOrder: 1,
      scheduleType: "WEEKLY",
      frequencyWeeks: 4,
      nextDueDate: null,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: config.customerName,
      address: config.customerAddress,
      areaId: area.id,
      frequencyWeeks: 4,
      price: 18,
      active: true,
      nextDueDate: null,
      jobName: "Window Cleaning",
    },
  });

  let workDayId: number | null = null;
  let expectedNextDueLabel: string | null = null;

  if (includePastWorkDay) {
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const scheduledDate = addDays(todayUtc, -7);
    const nextDue = addDays(todayUtc, 28);

    const workDay = await prisma.workDay.create({
      data: {
        tenantId: tenant.id,
        areaId: area.id,
        date: scheduledDate,
        status: "PLANNED",
      },
    });

    await prisma.job.create({
      data: {
        tenantId: tenant.id,
        workDayId: workDay.id,
        customerId: customer.id,
        name: "Window Cleaning",
        status: "PENDING",
        price: customer.price,
      },
    });

    workDayId = workDay.id;
    expectedNextDueLabel = format(nextDue, "EEE d MMM yyyy");
  }

  return {
    tenantId: tenant.id,
    customerId: customer.id,
    workDayId,
    expectedNextDueLabel,
  };
}

async function main() {
  const tenantA = await upsertSmokeTenant({
    slug: "smoke-tenant-a",
    tenantName: "Smoke Tenant A",
    ownerName: "Smoke Owner A",
    ownerEmail: "smoke-owner-a@example.com",
    areaName: "Smoke Alpha Area",
    customerName: "Smoke Alpha Customer",
    customerAddress: "1 Smoke Street, Testville",
  }, true);

  const tenantB = await upsertSmokeTenant({
    slug: "smoke-tenant-b",
    tenantName: "Smoke Tenant B",
    ownerName: "Smoke Owner B",
    ownerEmail: "smoke-owner-b@example.com",
    areaName: "Smoke Beta Area",
    customerName: "Smoke Beta Customer",
    customerAddress: "2 Smoke Street, Testville",
  }, false);

  const fixtureDir = path.join(process.cwd(), "tests", "e2e");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, ".smoke-fixtures.json"),
    JSON.stringify({
      password: SMOKE_PASSWORD,
      tenantA: {
        email: "smoke-owner-a@example.com",
        customerId: tenantA.customerId,
        workDayId: tenantA.workDayId,
        expectedNextDueLabel: tenantA.expectedNextDueLabel,
      },
      tenantB: {
        email: "smoke-owner-b@example.com",
        customerId: tenantB.customerId,
      },
    }, null, 2)
  );

  console.log("Smoke fixtures prepared.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

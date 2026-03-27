import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const filePath = join(
  "c:\\Users\\User\\Desktop\\vs_copilot_Window Cleaning App",
  "src",
  "lib",
  "actions.ts"
);

let src = readFileSync(filePath, "utf8");
const original = src;

// ── 1. Add getActiveTenantId import ──────────────────────────────────────────
if (!src.includes("getActiveTenantId")) {
  src = src.replace(
    `import { startOfDay } from "date-fns";`,
    `import { startOfDay } from "date-fns";\nimport { getActiveTenantId } from "@/lib/tenant-context";`
  );
}

// ── 2. BusinessSettings → TenantSettings ─────────────────────────────────────
src = src.replace(/businessSettings/g, "tenantSettings");

// ── 3. WorkDay unique constraint changed: date_areaId → tenantId_date_areaId ──
src = src.replace(
  /where: \{ date_areaId: \{ date: d, areaId \} \}/g,
  "where: { tenantId_date_areaId: { tenantId, date: d, areaId } }"
);
// Also the variant without variable d:
src = src.replace(
  /where: \{ date_areaId: \{([^}]+)\} \}/g,
  "where: { tenantId_date_areaId: {$1, tenantId } }"
);

// ── 4. Add tenantId scoping inside each generated SQL where clause ────────────

// Helper: for each exported async function body, inject `const tenantId = await getActiveTenantId();`
// Pattern: find "export async function NAME(...) {" and inject after the opening brace.
// We only add it if the function body contains a prisma call.

src = src.replace(
  /(export async function \w+[^{]*\{)/g,
  (match) => {
    // avoid double-injecting
    return match;
  }
);

// ── 5. Scope prisma.X.findMany({ where: { ─────────────────────────────────────
// Models that have tenantId: area, customer, workDay, job, payment, holiday, tag, tenantSettings
const TENANT_MODELS = ["area", "customer", "workDay", "job", "payment", "holiday", "tag", "tenantSettings"];

// Insert tenantId into findMany/findFirst/count where clauses
TENANT_MODELS.forEach((model) => {
  const pat = new RegExp(`prisma\\.${model}\\.findMany\\(\\{\\s*where:\\s*\\{`, "g");
  src = src.replace(pat, `prisma.${model}.findMany({ where: { tenantId,`);

  const pat2 = new RegExp(`prisma\\.${model}\\.findFirst\\(\\{\\s*where:\\s*\\{`, "g");
  src = src.replace(pat2, `prisma.${model}.findFirst({ where: { tenantId,`);

  const pat3 = new RegExp(`prisma\\.${model}\\.count\\(\\{\\s*where:\\s*\\{`, "g");
  src = src.replace(pat3, `prisma.${model}.count({ where: { tenantId,`);

  // For create, inject tenantId into data:
  const pat4 = new RegExp(`prisma\\.${model}\\.create\\(\\{\\s*data:\\s*\\{`, "g");
  src = src.replace(pat4, `prisma.${model}.create({ data: { tenantId,`);

  // For createMany, inject tenantId into each object — handle separately via data: [...].map
  // (done manually below for specific cases)
});

// ── 6. Specific: job.createMany data map ──────────────────────────────────────
// These create newJobs.map(...) — need to add tenantId to each mapped object
// We handle it by replacing the createMany data pattern
src = src.replace(
  /prisma\.job\.createMany\(\{\s*data: newJobs\.map\(\(c\) => \(\{/g,
  "prisma.job.createMany({ data: newJobs.map((c) => ({ tenantId,"
);

// ── 7. tenantSettings: id where clause → tenantId where clause ───────────────
// Old pattern references `id: 1` for the singleton row; now it's `tenantId`
src = src.replace(
  /prisma\.tenantSettings\.findUnique\(\{ where: \{ id: 1 \} \}\)/g,
  "prisma.tenantSettings.findUnique({ where: { tenantId } })"
);
src = src.replace(
  /prisma\.tenantSettings\.upsert\(\{\s*where: \{ id: 1 \}/g,
  "prisma.tenantSettings.upsert({ where: { tenantId }"
);
src = src.replace(
  /prisma\.tenantSettings\.update\(\{\s*where: \{ id: 1 \}/g,
  "prisma.tenantSettings.update({ where: { tenantId }"
);

// ── 8. Scope area.count (unique constraint changed) ───────────────────────────
src = src.replace(
  /prisma\.area\.count\(\)/g,
  "prisma.area.count({ where: { tenantId } })"
);

// ── 9. area.create without existing where (getOrCreateOneOffSystemArea) ───────
// The create inside getOrCreateOneOffSystemArea won't have tenantId yet from step 5
// because that function body preceeds the export functions. It's internal so it
// needs `tenantId` passed in as a param — handled via the refactor of the caller.

// ── 10. Report ────────────────────────────────────────────────────────────────
const added = src.split("tenantId").length - original.split("tenantId").length;
console.log(`Added ${added} 'tenantId' references`);
console.log("Import present:", src.includes("getActiveTenantId"));
console.log("TenantSettings refs:", (src.match(/tenantSettings/g) || []).length);

writeFileSync(filePath, src, "utf8");
console.log("✓ actions.ts transformed");

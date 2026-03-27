import { readFileSync, writeFileSync } from "fs";

const filePath =
  "c:\\Users\\User\\Desktop\\vs_copilot_Window Cleaning App\\src\\lib\\actions.ts";

let src = readFileSync(filePath, "utf8");

// Add `const tenantId = await getActiveTenantId();` as the first statement
// inside every exported async function body.
// We also need it in the internal helper `getOrCreateOneOffSystemArea` which now
// needs a tenantId param, handled specially below.

let insertions = 0;

// Match: "export async function NAME(...) {\n"
// and inject after the opening brace if not already injected
src = src.replace(
  /(export async function \w+[^{]*\{)(\n)/g,
  (match, head, newline) => {
    insertions++;
    return `${head}${newline}  const tenantId = await getActiveTenantId();\n`;
  }
);

// ── getOrCreateOneOffSystemArea: change to accept tenantId as param ───────────
// It's called internally; we'll pass tenantId from the callers.
src = src.replace(
  `async function getOrCreateOneOffSystemArea() {`,
  `async function getOrCreateOneOffSystemArea(tenantId: number) {`
);

// ── Scope getOrCreateOneOffSystemArea's own queries ───────────────────────────
src = src.replace(
  `const existing = await prisma.area.findFirst({ where: { isSystemArea: true } });`,
  `const existing = await prisma.area.findFirst({ where: { tenantId, isSystemArea: true } });`
);
src = src.replace(
  `return prisma.area.create({\n    data: {\n      name: "__one-off__",`,
  `return prisma.area.create({\n    data: {\n      tenantId,\n      name: "__one-off__",`
);

// ── Fix callers of getOrCreateOneOffSystemArea to pass tenantId ───────────────
src = src.replace(
  /getOrCreateOneOffSystemArea\(\)/g,
  "getOrCreateOneOffSystemArea(tenantId)"
);

// ── autoAddToScheduledDays: add tenantId param ───────────────────────────────
src = src.replace(
  `async function autoAddToScheduledDays(customerId: number, areaId: number) {`,
  `async function autoAddToScheduledDays(tenantId: number, customerId: number, areaId: number) {`
);
src = src.replace(
  /autoAddToScheduledDays\(customerId, areaId\)/g,
  "autoAddToScheduledDays(tenantId, customerId, areaId)"
);

// ── Scope workDay upsert: constraint name changed ─────────────────────────────
// Old: where: { date_areaId: { date: d, areaId } }
// New: where: { tenantId_date_areaId: { tenantId, date: d, areaId } }
src = src.replace(
  /where: \{ date_areaId: \{ date: d, areaId \} \}/g,
  "where: { tenantId_date_areaId: { tenantId, date: d, areaId } }"
);
src = src.replace(
  /where: \{ date_areaId: \{ date: d, areaId: null \} \}/g,
  "where: { tenantId_date_areaId: { tenantId, date: d, areaId: null } }"
);
// workDay.findFirst with date: d, areaId: null (one-off)
src = src.replace(
  /prisma\.workDay\.findFirst\(\{ where: \{ tenantId, date: d, areaId: null \} \}\)/g,
  "prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: null } })"
);
// WorkDay create for one-offs
src = src.replace(
  /prisma\.workDay\.create\(\{ data: \{ tenantId, date: d \} \}\)/g,
  "prisma.workDay.create({ data: { tenantId, date: d } })"
);

// ── area.findUnique({ where: { name } }) — name is no longer globally unique ──
// Change to findFirst with tenantId scoping
src = src.replace(
  /prisma\.area\.findUnique\(\{ where: \{ name([^}]*)\} \}\)/g,
  "prisma.area.findFirst({ where: { tenantId, name$1} })"
);
src = src.replace(
  /await tx\.area\.findUnique\(\{ where: \{ name: ([^}]+)\} \}\)/g,
  "await tx.area.findFirst({ where: { tenantId, name: $1} })"
);

// ── tag.findUnique({ where: { name } }) — same issue ─────────────────────────
src = src.replace(
  /prisma\.tag\.findUnique\(\{ where: \{ name([^}]*)\} \}\)/g,
  "prisma.tag.findFirst({ where: { tenantId, name$1} })"
);

// ── tenantSettings: ensure where: { tenantId } references are correct ─────────
// The old code used `where: { id: 1 }` for the singleton; now it's `where: { tenantId }`
src = src.replace(/where: \{ tenantId, id: 1 \}/g, "where: { tenantId }");
src = src.replace(/where: \{ id: 1 \}/g, "where: { tenantId }");

// ── Job / Payment createMany: data arrays need tenantId per item ──────────────
// These are already handled if the outer create was caught; but createMany({ data: [...] })
// maps directly — ensure tenantId is in each entry via the map.

// Report
console.log(`Inserted tenantId var into ${insertions} exported functions`);
console.log("Total tenantId refs:", (src.match(/tenantId/g) || []).length);

writeFileSync(filePath, src, "utf8");
console.log("✓ Pass 2 complete");

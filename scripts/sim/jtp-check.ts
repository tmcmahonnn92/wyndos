// Ad-hoc: import a customer CSV (Wyndos template columns) into a fresh business and list
// active round customers who aren't on their area's booked run. Usage: CSV=path TODAY=YYYY-MM-DD
import { readFileSync } from "fs";
import prisma from "@/lib/db";
import { createBusiness, setToday, isoOf } from "./lib";
function parse(text: string) {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows;
}
const dmy = (s: string) => { const m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined; };
(async () => {
  setToday(process.env.TODAY ?? "2026-10-12");
  const { tenantId } = await createBusiness("jtp");
  const act = await import("@/lib/actions");
  const [head, ...body] = parse(readFileSync(process.env.CSV!, "utf8")).filter((r) => r.length > 3);
  const ix = (h: string) => head.indexOf(h);
  const recs = body.map((r) => ({
    name: r[ix("Name")], address: "", houseNameNumber: r[ix("House no./name")], street: r[ix("Street")], town: r[ix("Town")], postcode: r[ix("Postcode")],
    areaName: r[ix("Area")], price: Number(r[ix("Price")]) || 0, frequencyWeeks: Number(r[ix("Every (weeks)")]) || undefined,
    nextDueDate: dmy(r[ix("Next due")]), lastCompletedDate: dmy(r[ix("Last cleaned")]), phone: r[ix("Phone")], email: r[ix("Email")],
    jobName: r[ix("Job name")], tags: r[ix("Tags")] ? r[ix("Tags")].split(/;\s*/) : [], notes: r[ix("Notes")],
  }));
  if (process.env.FIRST) {
    const [h1, ...b1] = parse(readFileSync(process.env.FIRST, "utf8")).filter((r) => r.length > 3); void h1;
    await act.bulkImportCustomers(recs.slice(0, b1.length) as never, { createMissingAreas: true, bookRuns: true } as never);
  }
  const res = await act.bulkImportCustomers(recs as never, { createMissingAreas: true, bookRuns: true } as never);
  console.log("created", (res as { created: number }).created, "skipped", (res as { skipped: number }).skipped, JSON.stringify((res as { skippedRows: unknown[] }).skippedRows.slice(0, 50)));
  const areas = await prisma.area.findMany({ where: { tenantId }, include: { customers: { where: { active: true } }, workDays: { where: { status: { not: "COMPLETE" } }, include: { jobs: true }, orderBy: { date: "asc" } } } });
  for (const a of areas) {
    const run = a.workDays.find((d) => !d.partOfId);
    console.log(`\n${a.name}${a.isSystemArea ? " (system)" : ""}: ${a.customers.length} customers, every ${a.frequencyWeeks}w, run ${run ? isoOf(run.date) + " with " + run.jobs.length : "none"}, area due ${isoOf(a.nextDueDate)}`);
    if (!run) continue;
    const on = new Set(a.workDays.flatMap((d) => d.jobs.map((j) => j.customerId)));
    for (const c of a.customers) if (!on.has(c.id)) console.log(`   not on run: ${c.name}, ${c.address} — due ${isoOf(c.nextDueDate)}, every ${c.frequencyWeeks}w`);
  }
  process.exit(0);
})();

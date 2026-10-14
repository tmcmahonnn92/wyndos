/**
 * Extra guide screenshots: Direct Debit (sharing, collecting), a customer's money buttons,
 * and working with no signal. Demo business only:
 *   DATABASE_URL=… npx tsx scripts/seed-guide-demo.ts
 *   DATABASE_URL=… npx tsx scripts/seed-guide-dd.ts
 *   node scripts/guide-extra-shots.mjs [baseUrl]   (then scripts/guide-compress.py)
 */
import { chromium } from "playwright";
import fs from "node:fs";

const B = process.argv[2] || "http://localhost:3000";
const OUT = ".tmp-test/guide-shots";
fs.mkdirSync(OUT, { recursive: true });
const ids = JSON.parse(fs.readFileSync(".tmp-test/guide-ids.json", "utf8"));
const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--no-sandbox", "--disable-gpu", "--no-zygote", "--disable-dev-shm-usage", "--lang=en-GB"],
});
async function login(page) {
  await page.goto(B + "/auth/signin");
  await page.fill("input[type=email]", "sam@example.com");
  await page.fill("input[type=password]", "GuideDemo123!");
  await page.click("button[type=submit]");
  await page.waitForTimeout(3000);
  await page.goto(B + "/");
  await page.waitForTimeout(1000);
}
const go = async (page, path, wait = 2000) => { await page.goto(B + path); await page.waitForTimeout(wait); };
const shot = async (target, name, opts = {}) => { await target.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log("ok", name); };
const attempt = async (name, fn) => { try { await fn(); } catch (e) { console.log("FAILED", name, String(e).split("\n")[0]); } };

// ── Desktop ───────────────────────────────────────────────────────
let browser = await launch();
const dc = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: "en-GB", timezoneId: "UTC" });
const d = await dc.newPage();
await login(d);
await attempt("d-dd-collect", async () => {
  await go(d, "/payments/direct-debit", 2500);
  await d.getByRole("button", { name: /^To collect/ }).click(); await d.waitForTimeout(600);
  await shot(d, "d-dd-collect");
});
await attempt("d-dd-customers", async () => {
  await d.getByRole("button", { name: /^Customers/ }).click(); await d.waitForTimeout(800);
  await shot(d, "d-dd-customers");
  await d.getByRole("button", { name: /Use another/ }).first().click(); await d.waitForTimeout(800);
  await d.getByPlaceholder("Search name or address").last().fill("Paul"); await d.waitForTimeout(400);
  const picker = d.getByText("Who pays for this customer?").locator("xpath=ancestor::tr[1]");
  await picker.scrollIntoViewIfNeeded();
  await shot(d, "d-dd-share");
});
await attempt("d-customer-money", async () => {
  await go(d, "/customers/" + ids.sarah, 2500);
  // Their balance (with credit and its buttons) at the top, then the payments list.
  // Just the page's middle column (the customer page is narrow on a computer).
  const clip = { x: 493, y: 0, width: 518, height: 800 };
  await shot(d, "d-customer-money", { clip });
  const pay = d.getByText("Payments", { exact: true }).last();
  await pay.scrollIntoViewIfNeeded(); await d.evaluate(() => window.scrollBy(0, -120)); await d.waitForTimeout(500);
  await shot(d, "d-customer-payments", { clip });
});
await browser.close();

// ── Phone ─────────────────────────────────────────────────────────
browser = await launch();
const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" });
const p = await pc.newPage();
await login(p);
await attempt("p-customer-dd", async () => {
  await go(p, "/customers/" + ids.helen, 3000);
  const panel = p.getByText("Direct Debit", { exact: true }).last();
  await panel.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, 220)); await p.waitForTimeout(600);
  await shot(p, "p-customer-dd");
});
await attempt("p-offline", async () => {
  await go(p, `/days/${ids.oakfield}`, 3000);
  await p.evaluate(() => navigator.serviceWorker?.ready); await p.reload(); await p.waitForTimeout(2500);
  await pc.setOffline(true);
  const done = (name) => p.locator("div").filter({ hasText: name }).filter({ has: p.getByRole("button", { name: /^Done$/ }) }).last().getByRole("button", { name: /^Done$/ }).first();
  await done("Claire Taylor").click(); await p.waitForTimeout(800);
  await done("Steve Walker").click(); await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400);
  await shot(p, "p-offline");
  // Put them back: nothing is sent from this screenshot run.
  await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("wyndos-offline", 1); r.onsuccess = () => { const t = r.result.transaction("queue", "readwrite"); t.objectStore("queue").clear(); t.oncomplete = () => res(); }; }));
  await pc.setOffline(false);
});
await attempt("p-needs-checking", async () => {
  await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("wyndos-offline", 1); r.onsuccess = () => { const t = r.result.transaction("problems", "readwrite");
    t.objectStore("problems").put({ id: "demo-1", at: Date.now(), error: "Job not found", action: { id: "demo-1", kind: "complete", jobId: 1, workDayId: 1, createdAt: Date.now() - 3 * 3600_000, label: "Ruth Wilson, 26 Oak Lane, Northbrook, NB1 4AR" } });
    t.oncomplete = () => res(); }; }));
  await go(p, `/days/${ids.oakfield}`, 3000);
  await p.getByText(/needs checking/).click(); await p.waitForTimeout(600);
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "p-needs-checking");
  await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("wyndos-offline", 1); r.onsuccess = () => { const t = r.result.transaction("problems", "readwrite"); t.objectStore("problems").clear(); t.oncomplete = () => res(); }; }));
});
await browser.close();

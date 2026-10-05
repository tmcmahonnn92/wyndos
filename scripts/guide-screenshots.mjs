/**
 * Screenshots for the Getting started guide (/guide), taken from the demo business.
 *   1. DATABASE_URL=… npx tsx scripts/seed-guide-demo.ts
 *   2. Run the app, then: node scripts/guide-screenshots.mjs [baseUrl]
 * Writes PNGs to .tmp-test/guide-shots/; scripts/guide-compress.py turns them into public/screens/guide/*.webp.
 * Set CHROMIUM=/path/to/chrome if Playwright's own browser isn't installed.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const B = process.argv[2] || "http://localhost:3000";
const OUT = ".tmp-test/guide-shots";
const CSV = new URL("./guide-demo-import.csv", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--no-sandbox", "--disable-gpu", "--single-process", "--no-zygote", "--disable-dev-shm-usage", "--lang=en-GB"],
  env: { ...process.env, LANG: "en_GB.UTF-8", LANGUAGE: "en_GB" },
});

async function login(page, email) {
  await page.goto(B + "/auth/signin");
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", "GuideDemo123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
  await page.waitForTimeout(1200);
}
async function go(page, path, wait = 1800) { await page.goto(B + path); await page.waitForTimeout(wait); }
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log("ok", name);
}
async function attempt(name, fn) {
  try { await fn(); } catch (e) { console.log("FAILED", name, String(e).split("\n")[0]); }
}
const ids = JSON.parse(fs.readFileSync(".tmp-test/guide-ids.json", "utf8"));
const riverside = `/days/${ids.riverside}`;
const oakfield = `/days/${ids.oakfield}`;

// ── Desktop, owner ─────────────────────────────────────────────
let browser = await launch();
const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-GB", timezoneId: "UTC" });
const d = await desk.newPage();
await login(d, "sam@example.com");

await attempt("d-dashboard", async () => { await go(d, "/"); await shot(d, "d-dashboard"); });
await attempt("d-business", async () => { await go(d, "/settings"); await shot(d, "d-business"); });
await attempt("d-areas", async () => { await go(d, "/areas"); await shot(d, "d-areas"); });
await attempt("d-area-add", async () => {
  await d.getByRole("button", { name: /Add Area/ }).click(); await d.waitForTimeout(600);
  const name = d.getByPlaceholder("e.g. North Zone");
  await name.fill("Willow Park");
  await d.waitForTimeout(300);
  await shot(d, "d-area-add");
  await d.keyboard.press("Escape");
});
await attempt("d-import", async () => {
  await go(d, "/customers/import");
  await d.locator("input[type=file]").first().setInputFiles(CSV); await d.waitForTimeout(1800);
  await d.getByText("Create new areas automatically").click(); await d.waitForTimeout(300);
  await shot(d, "d-import-map");
  await d.getByRole("button", { name: /Preview \d+ rows/ }).click(); await d.waitForTimeout(1500);
  await d.evaluate(() => window.scrollTo(0, 0)); await d.waitForTimeout(300);
  await shot(d, "d-import-preview");
});
await attempt("d-customers", async () => { await go(d, "/customers"); await shot(d, "d-customers"); });
await attempt("d-scheduler", async () => {
  await go(d, "/scheduler", 2500); await shot(d, "d-scheduler-month");
  await d.getByRole("button", { name: "Week", exact: true }).click(); await d.waitForTimeout(1200);
  await shot(d, "d-scheduler-week");
});
await attempt("d-team", async () => {
  await go(d, "/settings"); await d.getByRole("tab", { name: /Team/ }).click(); await d.waitForTimeout(800);
  await shot(d, "d-team");
});
await attempt("d-assign", async () => {
  await go(d, riverside, 2000);
  await d.getByRole("button", { name: /worker, print, move jobs/ }).click(); await d.waitForTimeout(700);
  await shot(d, "d-assign");
});
await attempt("d-reminders", async () => {
  await go(d, riverside, 2000);
  await d.getByRole("button", { name: "More" }).click(); await d.waitForTimeout(500);
  await d.getByRole("button", { name: /Text reminders/ }).click(); await d.waitForTimeout(1500);
  await shot(d, "d-reminders");
});
await attempt("d-texts", async () => { await go(d, "/messages"); await shot(d, "d-texts"); });
await attempt("d-payments", async () => { await go(d, "/payments"); await shot(d, "d-payments"); });
await browser.close();

// ── Phone, owner ───────────────────────────────────────────────
const phoneOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" };
browser = await launch();
const pc = await browser.newContext(phoneOpts);
const p = await pc.newPage();
await login(p, "sam@example.com");
await attempt("p-dashboard", async () => { await go(p, "/"); await shot(p, "p-dashboard"); });
await attempt("p-day", async () => { await go(p, oakfield, 2200); await shot(p, "p-day"); });
await attempt("p-done-paid", async () => {
  await p.getByRole("button", { name: /Done & Paid/ }).first().click(); await p.waitForTimeout(1200);
  await shot(p, "p-done-paid");
});
await attempt("p-scheduler", async () => {
  await go(p, "/scheduler", 2200);
  await p.locator("div.md\\:hidden button", { hasText: /^6$/ }).first().click(); await p.waitForTimeout(400);
  await shot(p, "p-scheduler");
});
await attempt("p-menu", async () => {
  await go(p, "/");
  await p.getByLabel("Open quick actions").click(); await p.waitForTimeout(500);
  await shot(p, "p-menu");
});
await browser.close();

// ── Phone, worker ──────────────────────────────────────────────
browser = await launch();
const wc = await browser.newContext(phoneOpts);
const w = await wc.newPage();
await login(w, "jamie@example.com");
await attempt("p-worker", async () => { await go(w, "/"); await shot(w, "p-worker"); });
await attempt("p-worker-day", async () => { await go(w, riverside, 2200); await shot(w, "p-worker-day"); });
await browser.close();

/**
 * Screenshots for the landing page (public/screens/*.jpg), from the made-up demo business.
 *   1. DATABASE_URL=… npx tsx scripts/seed-guide-demo.ts
 *   2. Run the app, then: node scripts/landing-screenshots.mjs [baseUrl]
 *   3. python3 scripts/landing-compress.py
 * Same views and sizes as before: desktop 1360×850 @1.5, phone 390×664 @3.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const B = process.argv[2] || "http://localhost:3000";
const OUT = ".tmp-test/landing-shots";
fs.mkdirSync(OUT, { recursive: true });
const ids = JSON.parse(fs.readFileSync(".tmp-test/guide-ids.json", "utf8"));
const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--no-sandbox", "--disable-gpu", "--single-process", "--no-zygote", "--disable-dev-shm-usage", "--lang=en-GB"],
  env: { ...process.env, LANG: "en_GB.UTF-8", LANGUAGE: "en_GB" },
});
const UK = { locale: "en-GB", timezoneId: "UTC" };

async function login(page) {
  await page.goto(B + "/auth/signin");
  await page.fill("input[type=email]", "sam@example.com");
  await page.fill("input[type=password]", "GuideDemo123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
  await page.waitForTimeout(1200);
}
async function shot(page, path, name, wait = 2200, before) {
  await page.goto(B + path); await page.waitForTimeout(wait);
  if (before) await before(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("ok", name);
}

let b = await launch();
let p = await (await b.newContext({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1.5, ...UK })).newPage();
await login(p);
await shot(p, "/scheduler", "scheduler", 2500, async (pg) => { await pg.getByRole("button", { name: "Week", exact: true }).click(); await pg.waitForTimeout(1200); });
await shot(p, "/", "dashboard");
await shot(p, "/customers", "customers");
await b.close();

b = await launch();
p = await (await b.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...UK })).newPage();
await login(p);
await shot(p, `/days/${ids.riverside}`, "day-phone");
await shot(p, `/customers/${ids.owingCustomer}`, "customer-phone");
await shot(p, "/messages", "texts-phone");
await b.close();

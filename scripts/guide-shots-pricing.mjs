/**
 * Guide screenshots for the price calculator and extras for the next visit. Demo business only.
 *   node scripts/guide-shots-pricing.mjs [baseUrl] [quoteCustomerName] [customerId]   (then scripts/guide-compress.py)
 * Needs one open quote in the demo business (quoteCustomerName) and a customer in an area (customerId).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const B = process.argv[2] || "http://localhost:3000";
const QUOTE = process.argv[3] || "";
const CUSTOMER = process.argv[4] || "";
const OUT = ".tmp-test/guide-shots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox", "--disable-gpu", "--lang=en-GB"] });
async function login(page) {
  await page.goto(B + "/auth/signin");
  await page.fill("input[type=email]", "sam@example.com");
  await page.fill("input[type=password]", "GuideDemo123!");
  await page.click("button[type=submit]");
  await page.waitForTimeout(3000);
}
const shot = async (p, name, opts = {}) => { await p.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log("ok", name); };

const dc = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: "en-GB", timezoneId: "UTC" });
const d = await dc.newPage();
await login(d);
await d.goto(B + "/quotes/calculator"); await d.waitForTimeout(2500);
await d.getByRole("button", { name: "Semi-detached" }).click();
await d.getByRole("button", { name: "3 bed" }).click();
await d.selectOption('select[aria-label="Add an item"]', "solar");
await d.fill('input[aria-label="Solar panel quantity"]', "10");
await d.selectOption('select[aria-label="Add an item"]', "cons_roof");
await d.getByRole("button", { name: "Show workings" }).click();
await d.waitForTimeout(500);
await shot(d, "d-calculator");
await d.getByRole("button", { name: "Commercial" }).click();
await d.selectOption('select[aria-label="Add an item"]', "pane");
await d.fill('input[aria-label="Commercial glass quantity"]', "180");
await d.getByRole("button", { name: "+ Add a building or elevation" }).click();
await d.locator('select[aria-label="Add an item"]').nth(1).selectOption("pane");
await d.locator('input[aria-label="Commercial glass quantity"]').nth(1).fill("60");
await d.locator('select[aria-label="Storey"]').nth(1).selectOption("3");
await d.fill('input[type="number"] >> nth=-2', "2").catch(() => {});
await d.waitForTimeout(500);
await shot(d, "d-calculator-commercial");
await d.getByRole("button", { name: "Price list" }).click(); await d.waitForTimeout(500);
await shot(d, "d-price-list");
await d.getByRole("button", { name: "Items" }).click(); await d.waitForTimeout(400);
await shot(d, "d-price-list-items");

const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" });
const p = await pc.newPage();
await login(p);
if (QUOTE) {
  await p.goto(B + "/quotes"); await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /^To visit/ }).click(); await p.waitForTimeout(500);
  await shot(p, "p-quote-price-it");
  await p.getByRole("button", { name: "Price it" }).first().click(); await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "Detached" }).last().click();
  await p.getByRole("button", { name: "4 bed" }).last().click();
  await p.getByText("Inside as well").click();
  await p.waitForTimeout(400);
  await shot(p, "p-price-it");
}
if (CUSTOMER) {
  await p.goto(B + "/customers/" + CUSTOMER); await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /One-off Job/ }).click(); await p.waitForTimeout(500);
  await p.getByPlaceholder(/Conservatory Clean/).fill("Conservatory roof");
  await p.locator('input[type="number"]').last().fill("35").catch(() => {});
  await p.getByPlaceholder(/conservatory only/).fill("Inside and out");
  await p.waitForTimeout(300);
  await shot(p, "p-next-visit");
}
await browser.close();

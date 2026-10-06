/**
 * Extra Getting started screenshots: ordering a day (whole day, two areas) and the worker
 * "Change job order" permission. Uses the demo business (scripts/seed-guide-demo.ts) with
 * a second area put on the same date first, e.g. Riverside moved onto Oakfield's date:
 *   UPDATE "WorkDay" SET date = <oakfield's date> WHERE id = <riverside's id>;
 *   node scripts/guide-day-order-shots.mjs YYYY-MM-DD [baseUrl]
 * Then scripts/guide-compress.py. Put Riverside back afterwards.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const DATE = process.argv[2];
const B = process.argv[3] || "http://localhost:3000";
const OUT = ".tmp-test/guide-shots";
fs.mkdirSync(OUT, { recursive: true });
const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--no-sandbox", "--disable-gpu", "--single-process", "--no-zygote", "--disable-dev-shm-usage", "--lang=en-GB"],
});
async function session(email, viewport, fn) {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, timezoneId: "UTC", locale: "en-GB" })).newPage();
  await page.goto(B + "/auth/signin");
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", "GuideDemo123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
  await page.waitForTimeout(1200);
  try { await fn(page); } catch (e) { console.log("FAILED", String(e).split("\n")[0]); }
  await browser.close();
}
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log("ok", name); };
const names = (page) => page.locator("button[aria-label$=' up']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Move | up$/g, "")));

await session("sam@example.com", { width: 1280, height: 1000 }, async (page) => {
  await page.goto(`${B}/days/date/${DATE}`); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /^Reorder$/ }).click(); await page.waitForTimeout(800);
  const list = await names(page);
  // Move the first job of the second area up, in among the first area's jobs.
  const firstArea = await page.locator("span.text-xs.font-bold").first().innerText();
  const counts = await page.locator("span.text-xs.text-slate-400").first().innerText();
  const mover = list[Number(counts)];
  await page.getByRole("button", { name: `Move ${mover} up` }).click(); await page.waitForTimeout(3000);
  await shot(page, "d-day-always");
  await page.getByRole("button", { name: "Just today" }).click(); await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
  await shot(page, "d-day-order");
  console.log("moved", mover, "into", firstArea);
});

await session("sam@example.com", { width: 1280, height: 900 }, async (page) => {
  await page.goto(`${B}/settings`); await page.waitForTimeout(2000);
  await page.getByRole("tab", { name: /Team/ }).click(); await page.waitForTimeout(800);
  await page.getByTitle("Edit permissions").first().click(); await page.waitForTimeout(800);
  const editor = page.getByText("Edit permissions:").locator("..");
  await editor.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const box = await editor.boundingBox();
  await shot(page, "d-team-reorder", { clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 90), width: Math.min(1280 - box.x + 16, box.width + 32), height: box.height + 110 } });
});

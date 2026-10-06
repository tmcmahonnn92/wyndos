import { chromium } from "playwright";
const B="http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/tmp/chromium", args: ["--no-sandbox","--disable-gpu","--single-process","--no-zygote","--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 420, height: 1600 } })).newPage();
page.on("pageerror", e => console.log("PAGEERR", e.message));
await page.goto(B+"/auth/signin"); await page.fill("input[type=email]","sam@example.com"); await page.fill("input[type=password]","GuideDemo123!"); await page.click("button[type=submit]"); await page.waitForTimeout(2000);
const names = async () => (await page.locator("section").first().innerText()).split("\n").filter(Boolean).slice(0, 60).join(" | ");
await page.goto(B+"/days/date/2026-10-06"); await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/claude-0/d1.png", fullPage: false });
await page.getByRole("button", { name: /^Reorder$/ }).click(); await page.waitForTimeout(800);
// Move Riverside up above Oakfield
await page.getByRole("button", { name: /Move Riverside earlier/ }).click(); await page.waitForTimeout(3500);
await page.screenshot({ path: "/tmp/claude-0/d2.png" });
// Move first Oakfield job up once (into Riverside's block)
const ups = page.getByRole("button", { name: /up$/ });
const cards = await page.locator("button[aria-label$=' up']").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
console.log("first cards:", cards.slice(0, 16).join(" ; "));
await browser.close();

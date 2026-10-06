import { chromium } from "playwright";
const B="http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/tmp/chromium", args: ["--no-sandbox","--disable-gpu","--single-process","--no-zygote","--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 1400, height: 1000 } })).newPage();
page.on("pageerror", e => console.log("PAGEERR", e.message));
await page.goto(B+"/auth/signin"); await page.fill("input[type=email]","sam@example.com"); await page.fill("input[type=password]","GuideDemo123!"); await page.click("button[type=submit]"); await page.waitForTimeout(2000);
const order = async () => (await page.locator("button[aria-label$=' up']").evaluateAll(els => els.map(e => e.getAttribute("aria-label").replace(/^Move | up$/g, ""))));
await page.goto(B+"/days/date/2026-10-06"); await page.waitForTimeout(3000);
await page.getByRole("button", { name: /^Reorder$/ }).click(); await page.waitForTimeout(800);
let o = await order();
// In-area move: second Riverside job up
await page.getByRole("button", { name: `Move ${o[1]} up` }).click(); await page.waitForTimeout(3500);
console.log("offer:", await page.locator("text=Moved for today").innerText().catch(() => "none"));
await page.getByRole("button", { name: "Change it" }).click(); await page.waitForTimeout(3000);
console.log("first two now:", (await order()).slice(0, 2).join(", "));
await page.getByRole("button", { name: "Sort each area by street" }).click(); await page.waitForTimeout(4000);
console.log("street:", (await order()).slice(0, 6).join(", "));
await page.getByRole("button", { name: "Back to normal order" }).click(); await page.waitForTimeout(4000);
o = await order(); console.log("reset: first area first job", o[0], "| Claire after Helen still:", o[o.indexOf("Helen Hall") + 1]);
// Scheduler: click blank part of a cell
await page.goto(B+"/scheduler"); await page.waitForTimeout(4000);
const cell = page.locator("div[title='Open the whole day']").first();
const box = await cell.boundingBox();
await page.mouse.click(box.x + 6, box.y + box.height - 6); await page.waitForTimeout(3000);
console.log("scheduler click went to:", new URL(page.url()).pathname);
await browser.close();

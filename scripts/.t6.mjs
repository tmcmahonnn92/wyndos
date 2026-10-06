import { chromium } from "playwright";
const B="http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/tmp/chromium", args: ["--no-sandbox","--disable-gpu","--single-process","--no-zygote","--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 420, height: 900 } })).newPage();
await page.goto(B+"/auth/signin"); await page.fill("input[type=email]","sam@example.com"); await page.fill("input[type=password]","GuideDemo123!"); await page.click("button[type=submit]"); await page.waitForTimeout(2000);
await page.goto(B+"/days/date/2026-10-06"); await page.waitForTimeout(3000);
await page.getByText("Claire Taylor").first().scrollIntoViewIfNeeded(); await page.mouse.wheel(0, -250); await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/claude-0/d4.png" });
await browser.close();

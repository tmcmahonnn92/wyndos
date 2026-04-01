import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";

const baseUrl = "https://wyndos.io";

type Finding = {
  severity: "Critical" | "High" | "Medium" | "Low";
  area: string;
  title: string;
  detail: string;
};

function futureDate(offsetDays: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function clickButton(page: Page, name: RegExp | string) {
  await page.getByRole("button", { name }).click();
}

async function fillByLabel(page: Page, label: string | RegExp, value: string) {
  const control = page.getByLabel(label).first();
  await control.fill(value);
}

async function waitForUrl(page: Page, pattern: RegExp, timeout = 30000) {
  await page.waitForURL(pattern, { timeout });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await clickButton(page, /^Sign in$/);
  await waitForUrl(page, /\/$/);
}

async function addArea(page: Page, name: string, frequency: "4" | "8" | "12", firstDueDate: string) {
  await page.goto(`${baseUrl}/scheduler`, { waitUntil: "domcontentloaded" });
  await clickButton(page, /^Area$/);
  await fillByLabel(page, /Area name/i, name);
  await page.getByRole("button", { name: new RegExp(`^${frequency}w$`) }).click();
  await page.locator('input[type="date"]').last().fill(firstDueDate);
  await page.getByRole("button", { name: /^Add Area$/ }).last().click();
  await page.getByText(name, { exact: true }).waitFor({ timeout: 20000 });
}

async function addCustomer(page: Page, input: {
  name: string;
  areaName: string;
  price: string;
  phone?: string;
  notes?: string;
}) {
  await page.goto(`${baseUrl}/customers`, { waitUntil: "domcontentloaded" });
  await clickButton(page, /^Add Customer$/);
  await fillByLabel(page, /^Name \*$/i, input.name);
  if (input.phone) await fillByLabel(page, /^Phone$/i, input.phone);
  await page.getByLabel(/^Area \*$/i).selectOption({ label: input.areaName });
  await fillByLabel(page, /^Price \(£\) \*$/i, input.price);
  if (input.notes) await fillByLabel(page, /^Notes$/i, input.notes);
  await page.getByRole("button", { name: /^Add Customer$/ }).last().click();
  await page.getByText(input.name, { exact: true }).waitFor({ timeout: 20000 });
}

async function dragAreaToWeekCell(page: Page, areaName: string, cellIndex: number) {
  await page.goto(`${baseUrl}/scheduler`, { waitUntil: "domcontentloaded" });
  const source = page.locator('div[draggable="true"]').filter({ has: page.getByText(areaName, { exact: true }) }).first();
  const target = page.locator('div.grid.grid-cols-7.gap-1\.5.p-2.min-h-full > div').nth(cellIndex);
  await source.dragTo(target);
  await page.getByText(areaName, { exact: true }).nth(1).waitFor({ timeout: 20000 });
}

async function dragScheduledDayToWeekCell(page: Page, areaName: string, cellIndex: number) {
  const source = page.locator('div[draggable="true"]').filter({ has: page.getByText(areaName, { exact: true }) }).last();
  const target = page.locator('div.grid.grid-cols-7.gap-1\.5.p-2.min-h-full > div').nth(cellIndex);
  await source.dragTo(target);
  await page.waitForLoadState("networkidle");
}

async function inviteWorker(page: Page, email: string) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Team$/ }).click();
  await page.locator('input[type="email"]').first().fill(email);
  await clickButton(page, /^Send Invite$/);
  const inviteCode = page.locator("code").first();
  await inviteCode.waitFor({ timeout: 20000 });
  return (await inviteCode.innerText()).trim();
}

async function acceptInvite(browserContext: BrowserContext, link: string, password: string) {
  const page = await browserContext.newPage();
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await fillByLabel(page, /Your full name/i, "Field Worker");
  await fillByLabel(page, /Create a password/i, password);
  await fillByLabel(page, /Confirm password/i, password);
  await clickButton(page, /Accept invite and join/i);
  await waitForUrl(page, /\/$/);
  return page;
}

async function collectNavLabels(page: Page) {
  const labels = await page.locator("nav a, nav button").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").trim()).filter(Boolean)
  );
  return Array.from(new Set(labels));
}

async function main() {
  const suffix = Date.now().toString().slice(-6);
  const ownerEmail = `operator-sim-${suffix}@example.com`;
  const ownerPassword = "RoundTest123!";
  const workerEmail = `worker-sim-${suffix}@example.com`;
  const workerPassword = "WorkerTest123!";
  const findings: Finding[] = [];
  const notes: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const ownerPage = await ownerContext.newPage();
  const browserErrors: string[] = [];

  ownerPage.on("pageerror", (error) => {
    browserErrors.push(`[pageerror] ${error.name}: ${error.message}`);
  });
  ownerPage.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`[console] ${message.text()}`);
    }
  });

  try {
    notes.push(`Created fresh live owner account ${ownerEmail}.`);
    await ownerPage.goto(`${baseUrl}/auth/signup`, { waitUntil: "domcontentloaded" });
    await ownerPage.locator('input[name="name"]').fill("Sheffield Operator");
    await ownerPage.locator('input[name="companyName"]').fill(`Sheffield Round ${suffix}`);
    await ownerPage.locator('input[name="email"]').fill(ownerEmail);
    await ownerPage.locator('input[name="password"]').fill(ownerPassword);
    await ownerPage.locator('input[name="confirm"]').fill(ownerPassword);
    await clickButton(ownerPage, /^Create account$/);
    await waitForUrl(ownerPage, /\/auth\/onboarding$/);
    await ownerPage.waitForLoadState("domcontentloaded");

    const onboardingError = ownerPage.getByText(/Application error: a client-side exception has occurred/i);
    if (await onboardingError.isVisible().catch(() => false)) {
      throw new Error(`Live onboarding crashed after signup at ${ownerPage.url()}. Browser errors: ${browserErrors.join(" | ") || "none captured"}`);
    }

    await ownerPage.locator('input[name="companyName"]').fill(`Sheffield Round ${suffix} Ltd`);
    await ownerPage.locator('input[name="ownerName"]').fill("Sheffield Operator");
    await ownerPage.locator('input[name="phone"]').fill("07700900123");
    await ownerPage.locator('input[name="address"]').fill("14 Division Street, Sheffield");
    await ownerPage.locator('input[name="website"]').fill("https://wyndos.io");
    await clickButton(ownerPage, /Finish setup and go to dashboard|Saving/i);
    await waitForUrl(ownerPage, /\/$/);
    notes.push("Owner signup and onboarding completed on the live VPS.");

    const areaA = `S6 Walk-Up ${suffix}`;
    const areaB = `Crookes Loop ${suffix}`;
    const areaC = `Ecclesall Edge ${suffix}`;
    await addArea(ownerPage, areaA, "4", futureDate(-6));
    await addArea(ownerPage, areaB, "8", futureDate(-4));
    await addArea(ownerPage, areaC, "12", futureDate(2));
    notes.push("Created 4-week, 8-week, and 12-week test areas.");

    await addCustomer(ownerPage, {
      name: `18 Thorncliffe ${suffix}`,
      areaName: areaA,
      price: "16",
      phone: "07700900111",
      notes: "Back gate usually unlocked. Cash on first clean.",
    });
    await addCustomer(ownerPage, {
      name: `20 Thorncliffe ${suffix}`,
      areaName: areaA,
      price: "18",
      phone: "07700900112",
      notes: "Dog in yard after 10am.",
    });
    await addCustomer(ownerPage, {
      name: `7 Tofts ${suffix}`,
      areaName: areaB,
      price: "22",
      phone: "07700900113",
      notes: "Side gate sometimes bolted.",
    });
    await addCustomer(ownerPage, {
      name: `4 Banner Cross ${suffix}`,
      areaName: areaC,
      price: "25",
      phone: "07700900114",
      notes: "Advance text preferred.",
    });
    notes.push("Added a small realistic domestic round across three areas.");

    await dragAreaToWeekCell(ownerPage, areaA, 0);
    await dragAreaToWeekCell(ownerPage, areaB, 2);
    await ownerPage.getByRole("button", { name: /next week/i }).click().catch(() => {});
    await dragAreaToWeekCell(ownerPage, areaC, 1);
    notes.push("Scheduled overdue and future work in the live scheduler.");

    await ownerPage.goto(`${baseUrl}/days`, { waitUntil: "domcontentloaded" });
    const dayCard = ownerPage.getByRole("link", { name: new RegExp(areaA) }).first();
    await dayCard.click();
    await clickButton(ownerPage, /^Start Area$/);
    await ownerPage.getByText(`18 Thorncliffe ${suffix}`, { exact: true }).click();
    await clickButton(ownerPage, /^Done$/);
    await ownerPage.getByText(`20 Thorncliffe ${suffix}`, { exact: true }).click();
    await clickButton(ownerPage, /^Skip$/);
    await clickButton(ownerPage, /^Complete Day$/);
    await clickButton(ownerPage, /^Confirm & Complete Day$/);
    await ownerPage.getByText(/Day complete!/i).waitFor({ timeout: 30000 });
    const nextRunText = await ownerPage.locator("text=Next").first().innerText().catch(() => "");
    notes.push(`Completed an overdue area day on the live system. ${nextRunText}`.trim());

    await ownerPage.goto(`${baseUrl}/scheduler`, { waitUntil: "domcontentloaded" });
    await dragScheduledDayToWeekCell(ownerPage, areaB, 4);
    notes.push("Rescheduled another live work day to simulate weather slippage.");

    const inviteLink = await inviteWorker(ownerPage, workerEmail);
    notes.push("Generated an in-app worker invite link from Settings > Team.");

    const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const workerPage = await acceptInvite(workerContext, inviteLink, workerPassword);
    const workerNav = await collectNavLabels(workerPage);
    notes.push(`Worker desktop nav labels: ${workerNav.join(", ")}`);

    const mobileContext = await browser.newContext({ ...devices["iPhone 13"] });
    const mobilePage = await mobileContext.newPage();
    await signIn(mobilePage, workerEmail, workerPassword);
    const mobileNav = await collectNavLabels(mobilePage);
    notes.push(`Worker mobile nav labels: ${mobileNav.join(", ")}`);

    if (!workerNav.some((label) => label.includes("Schedule"))) {
      findings.push({
        severity: "High",
        area: "Worker permissions",
        title: "Worker account did not expose schedule access after invite",
        detail: `Live worker nav was: ${workerNav.join(", ")}`,
      });
    }

    if (workerNav.some((label) => label.includes("Customers")) || workerNav.some((label) => label.includes("Areas"))) {
      findings.push({
        severity: "Medium",
        area: "Worker permissions",
        title: "Default worker invite appears broader than a typical field-only role",
        detail: `Worker nav after accepting a default invite was: ${workerNav.join(", ")}`,
      });
    }

    const summary = {
      ownerEmail,
      workerEmail,
      notes,
      findings,
    };
    console.log(JSON.stringify(summary, null, 2));

    await mobileContext.close();
    await workerContext.close();
    await ownerContext.close();
    await browser.close();
  } catch (error) {
    console.error("LIVE_OPERATOR_SIM_FAILED");
    console.error("CURRENT_URL", ownerPage.url());
    if (browserErrors.length > 0) {
      console.error("BROWSER_ERRORS_START");
      for (const entry of browserErrors) console.error(entry);
      console.error("BROWSER_ERRORS_END");
    }
    console.error(error);
    try {
      await ownerPage.screenshot({ path: `review documents/live-vps-operator-failure-${suffix}.png`, fullPage: true });
    } catch {}
    await ownerContext.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exitCode = 1;
  }
}

main();
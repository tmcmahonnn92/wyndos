import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

type Fixtures = {
  password: string;
  tenantA: { email: string; customerId: number; workDayId: number; expectedNextDueLabel: string };
  tenantB: { email: string; customerId: number };
};

const baseUrl = process.env.SMOKE_BASE_URL?.trim() || "http://127.0.0.1:3000";
const fixturePath = path.join(process.cwd(), "tests", "e2e", ".smoke-fixtures.json");

function readFixtures(): Fixtures {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixtures;
}

async function waitForHeading(page: Page, name: string) {
  await page.getByRole("heading", { name }).waitFor({ state: "visible", timeout: 60_000 });
}

async function signIn(page: Page, email: string, password: string) {
  const csrfResponse = await page.context().request.get(`${baseUrl}/api/auth/csrf`);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfToken) {
    throw new Error("Missing NextAuth CSRF token for staging validation sign-in.");
  }

  const signInResponse = await page.context().request.post(`${baseUrl}/api/auth/callback/credentials?json=true`, {
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: `${baseUrl}/`,
    },
  });

  if (!signInResponse.ok()) {
    throw new Error(`Staging validation sign-in failed with status ${signInResponse.status()}.`);
  }

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/$/, { timeout: 60_000 });
  await waitForHeading(page, "Dashboard");
}

async function progressDayToCompletion(page: Page, workDayId: number) {
  await page.goto(`${baseUrl}/days/${workDayId}`, { waitUntil: "domcontentloaded" });

  const startAreaButton = page.getByRole("button", { name: "Start Area" });
  if (await startAreaButton.isVisible().catch(() => false)) {
    await startAreaButton.click();
  }

  await page.getByRole("button", { name: "Complete Day" }).click();
  await page.getByRole("button", { name: "Confirm & Complete Day" }).click();
}

async function runSignupScenario(browserContext: BrowserContext) {
  const unique = Date.now();
  const email = `signup-${unique}@example.com`;
  const page = await browserContext.newPage();

  await page.goto(`${baseUrl}/auth/signup`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="name"]').fill("Smoke Signup Owner");
  await page.locator('input[name="companyName"]').fill(`Smoke Signup ${unique}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("SmokePass123!");
  await page.locator('input[name="confirm"]').fill("SmokePass123!");
  await page.getByRole("button", { name: "Create account" }).click({ noWaitAfter: true });

  await page.waitForURL(/\/auth\/onboarding$/, { timeout: 60_000 });
  await page.locator('input[name="companyName"]').fill(`Smoke Signup ${unique} Ltd`);
  await page.locator('input[name="ownerName"]').fill("Smoke Signup Owner");
  await page.locator('input[name="phone"]').fill("07700900000");
  await page.locator('input[name="address"]').fill("1 Test Street, Smokeville");
  await page.locator('input[name="website"]').fill("https://example.com");
  await page.getByRole("button", { name: /Finish setup and go to dashboard|Saving/ }).click({ noWaitAfter: true });

  await page.waitForURL(/\/$/, { timeout: 60_000 });
  await waitForHeading(page, "Dashboard");
  await page.close();
}

async function runTenantIsolationScenario(browserContext: BrowserContext, fixtures: Fixtures) {
  const page = await browserContext.newPage();
  await signIn(page, fixtures.tenantA.email, fixtures.password);

  const response = await browserContext.request.get(`${baseUrl}/customers/${fixtures.tenantB.customerId}`);
  if (response.status() !== 404) {
    throw new Error(`Expected tenant-isolation request to return 404, received ${response.status()}.`);
  }

  await page.close();
}

async function runRecurrenceScenario(browserContext: BrowserContext, fixtures: Fixtures) {
  const page = await browserContext.newPage();
  await signIn(page, fixtures.tenantA.email, fixtures.password);
  await progressDayToCompletion(page, fixtures.tenantA.workDayId);

  await page.goto(`${baseUrl}/customers/${fixtures.tenantA.customerId}`, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor();
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(fixtures.tenantA.expectedNextDueLabel)) {
    throw new Error(`Expected customer page to include next-due label ${fixtures.tenantA.expectedNextDueLabel}.`);
  }
  await page.close();
}

async function main() {
  const fixtures = readFixtures();
  const browser = await chromium.launch({ headless: true });

  try {
    const signupContext = await browser.newContext({ baseURL: baseUrl });
    await runSignupScenario(signupContext);
    await signupContext.close();
    console.log("signup-onboarding: ok");

    const tenantContext = await browser.newContext({ baseURL: baseUrl });
    await runTenantIsolationScenario(tenantContext, fixtures);
    await tenantContext.close();
    console.log("tenant-isolation: ok");

    const recurrenceContext = await browser.newContext({ baseURL: baseUrl });
    await runRecurrenceScenario(recurrenceContext, fixtures);
    await recurrenceContext.close();
    console.log("recurrence-completion-date: ok");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

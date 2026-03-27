import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

const fixturePath = path.join(process.cwd(), "tests", "e2e", ".smoke-fixtures.json");

function readFixtures() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    password: string;
    tenantA: { email: string; customerId: number; workDayId: number; expectedNextDueLabel: string };
    tenantB: { email: string; customerId: number };
  };
}

async function signInWithCredentials(page: Page, email: string, password: string) {
  const csrfResponse = await page.context().request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfToken) throw new Error("Missing NextAuth CSRF token for smoke sign-in.");

  const signInResponse = await page.context().request.post("/api/auth/callback/credentials?json=true", {
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: "/",
    },
  });

  if (!signInResponse.ok()) {
    throw new Error(`Smoke sign-in failed with status ${signInResponse.status()}.`);
  }

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

async function progressDayToCompletion(page: Page, workDayId: number) {
  await page.goto(`/days/${workDayId}`);

  const startAreaButton = page.getByRole("button", { name: "Start Area" });
  if (await startAreaButton.isVisible().catch(() => false)) {
    await startAreaButton.click();
  }

  await page.getByRole("button", { name: "Complete Day" }).click();
  await page.getByRole("button", { name: "Confirm & Complete Day" }).click();
}

test("owner signup completes onboarding and lands on dashboard", async ({ page }) => {
  const unique = Date.now();
  const email = `signup-${unique}@example.com`;

  await page.goto("/auth/signup");
  await page.locator('input[name="name"]').fill("Smoke Signup Owner");
  await page.locator('input[name="companyName"]').fill(`Smoke Signup ${unique}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("SmokePass123!");
  await page.locator('input[name="confirm"]').fill("SmokePass123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/auth\/onboarding$/);
  await page.locator('input[name="companyName"]').fill(`Smoke Signup ${unique} Ltd`);
  await page.locator('input[name="ownerName"]').fill("Smoke Signup Owner");
  await page.locator('input[name="phone"]').fill("07700900000");
  await page.locator('input[name="address"]').fill("1 Test Street, Smokeville");
  await page.locator('input[name="website"]').fill("https://example.com");
  await page.getByRole("button", { name: /Finish setup and go to dashboard|Saving/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("owner cannot open another tenant customer by guessed id", async ({ page }) => {
  const fixtures = readFixtures();

  await signInWithCredentials(page, fixtures.tenantA.email, fixtures.password);

  const response = await page.context().request.get(`/customers/${fixtures.tenantB.customerId}`);
  expect(response.status()).toBe(404);
});

test("completing a past day advances next due from actual completion date", async ({ page }) => {
  const fixtures = readFixtures();

  await signInWithCredentials(page, fixtures.tenantA.email, fixtures.password);
  await progressDayToCompletion(page, fixtures.tenantA.workDayId);

  await page.goto(`/customers/${fixtures.tenantA.customerId}`);
  await page.locator("body").waitFor();
  await expect.poll(async () => (await page.locator("body").innerText()).includes(fixtures.tenantA.expectedNextDueLabel)).toBe(true);
});

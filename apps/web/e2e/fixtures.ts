// Shared Playwright helpers: talk to the mock API's test hooks and sign in without the UI when a test is
// not about the auth flow itself.
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export const API = `http://127.0.0.1:${process.env["MOCK_API_PORT"] ?? 3101}`;
export const TEST_OTP = "123456";

export async function resetApi(request: APIRequestContext) {
  await request.post(`${API}/__test/reset`);
}

export interface SeedOptions {
  email: string;
  password?: string;
  role?: "user" | "admin";
  plan?: { state: "free" | "active" | "expiring_soon" | "expired"; planName?: string; expiresAt?: string; daysLeft?: number };
  connected?: boolean;
  /** Seed this many referred sign-ups with commissions for the user (ADR-031). */
  referrals?: number;
  /** Seed this many banners (live, live, scheduled, hidden … cycling; ADR-033). */
  banners?: number;
}

export async function seedUser(request: APIRequestContext, opts: SeedOptions) {
  const res = await request.post(`${API}/__test/seed`, { data: opts });
  expect(res.ok()).toBeTruthy();
}

/** Sign in through the real UI (email + password) so the browser gets the session cookie via the proxy. */
export async function signIn(page: Page, email: string, password = "Passw0rd!") {
  await page.goto("/auth");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/\/analyse/);
}

export async function fillOtp(page: Page, code = TEST_OTP) {
  const boxes = page.getByTestId("otp-input").getByRole("textbox");
  await boxes.first().click();
  await page.keyboard.type(code);
}

export const test = base.extend<{ freshApi: void }>({
  freshApi: [
    async ({ request }, use) => {
      await resetApi(request);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

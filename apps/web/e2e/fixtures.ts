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
  /** Seed the four demo coupons (ADR-034); the community one is assigned to this user. */
  coupons?: boolean;
  /** Seed this many payment rows (paid, paid, failed, pending … cycling). */
  payments?: number;
  /** Seed this many sent campaigns for the History tab (ADR-035). */
  campaigns?: number;
  /** Seed the three demo alerts (ADR-052): BTC ≥ 82,000 (push, armed), BTC ATM IV ≤ 30 % (email, triggered), a P&L alert on the first active strategy or a named one (push + email, armed). */
  alerts?: boolean;
  /** Seed the account with a linked Telegram chat (ADR-057). */
  telegram?: boolean;
  /** Seed a closed round trip of exchange fills on the Main key for the verified P&L block (ADR-073); needs `connected`. */
  fills?: boolean;
  /** Turn the public trader page on at this handle with every section shown (ADR-075). */
  publicHandle?: string;
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

export const test = base.extend<{ freshApi: void; tour: boolean; tourOff: void }>({
  freshApi: [
    async ({ request }, use) => {
      await resetApi(request);
      await use();
    },
    { auto: true },
  ],
  /** Opt in with `test.use({ tour: true })`; otherwise the product tour is marked done so it never auto-starts. */
  tour: [false, { option: true }],
  tourOff: [
    async ({ page, tour }, use) => {
      if (!tour) await page.addInitScript(() => localStorage.setItem("hapiecoin.tour", "done"));
      await use();
    },
    { auto: true },
  ],
});

export { expect };

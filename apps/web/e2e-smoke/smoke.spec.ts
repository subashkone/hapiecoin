// Real integration smoke (ADR-055, GAPS #20): web ↔ apps/api (Better Auth, Drizzle, real routes) ↔ apps/gateway (the
// live Delta Exchange India public feed). Nothing here can trade: TRADING_DISABLED=1 and no exchange key exists.
// Paper trades, alerts and settings are bookkeeping in the real database and must survive a reload.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { fillOtp } from "../e2e/fixtures";

const SIDECAR = `http://127.0.0.1:${process.env["SMOKE_SIDECAR_PORT"] ?? 3203}`;
const email = `smoke-${Date.now().toString(36)}@hapiecoin.test`;
const PASSWORD = "Smoke1!pass9";

/** The OTP the API's capture mailer logged for `email`, as soon as the sidecar has seen it. */
async function otpFor(request: APIRequestContext, address: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${SIDECAR}/otp?email=${encodeURIComponent(address)}`);
    if (res.ok()) return ((await res.json()) as { otp: string }).otp;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no OTP logged for ${address} within 20 s`);
}

test.describe.serial("real API + gateway smoke", () => {
  test("health: the API answers and the gateway lists Delta expiries", async ({ request }) => {
    const health = (await (await request.get(`${SIDECAR}/healthz`)).json()) as { api: boolean; gateway: boolean };
    expect(health).toEqual({ api: true, gateway: true });
    const gw = (await (await request.get(`http://127.0.0.1:${process.env["SMOKE_GATEWAY_PORT"] ?? 3202}/healthz`)).json()) as { expiries?: Record<string, string[]>; feed?: { expiries?: Record<string, string[]> } };
    const btc = gw.feed?.expiries?.["BTC"] ?? gw.expiries?.["BTC"] ?? [];
    expect(btc.length).toBeGreaterThan(0);
  });

  test("sign up through Better Auth, verify the emailed OTP, land on /analyse with a live chain", async ({ page, request }) => {
    await page.goto("/auth?tab=signup");
    await page.getByLabel("Full Name").fill("Smoke Trader");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByLabel("Mobile Number").fill("9876543210");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
    await page.getByRole("textbox", { name: "Confirm", exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/tab=verify-email/);
    await fillOtp(page, await otpFor(request, email));
    await page.getByRole("button", { name: "Verify Email" }).click();
    await page.waitForURL(/\/analyse/);
    await expect(page.getByTestId("app-header")).toHaveAttribute("data-variant", "analyse");
    // the real gateway: futures price and a chain with venue strikes
    await expect(page.getByTestId("futures-price-value")).not.toHaveText("—", { timeout: 30_000 });
    await expect(page.getByTestId("feed-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9]\d*$/, { timeout: 30_000 });
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("header-atm-iv")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  });

  test("a paper trade and an alert are written by the real API and survive a reload; sign out ends the session", async ({ page, request }) => {
    // sign in with the password set above (a fresh browser context)
    await page.goto("/auth");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(/\/analyse/);
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 30_000 });
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-sell-puts").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("Smoke straddle");
    await page.getByTestId("builder-paper-trade").click();
    await page.getByTestId("trade-mode").getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 30_000 });
    await expect(page.getByTestId("paper-card").getByTestId("card-pnl")).not.toHaveText("—", { timeout: 30_000 });
    // an alert through /v1/alerts
    await page.getByTestId("alerts-bell").click();
    const dialog = page.getByTestId("alerts-dialog");
    await dialog.getByTestId("alerts-new").click();
    await dialog.getByTestId("alert-value").fill("1000000");
    await dialog.getByTestId("alert-save").click();
    await expect(dialog.getByTestId("alert-row")).toHaveCount(1);
    await expect(dialog.getByTestId("alert-row")).toHaveAttribute("data-state", "armed");
    await page.keyboard.press("Escape");
    // persistence: the strategy and the alert come back from the database
    await page.reload();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 30_000 });
    await expect(page.getByTestId("alerts-bell")).toHaveAttribute("data-armed", "1", { timeout: 30_000 });
    // the API itself, through the web rewrite, agrees
    const me = await page.request.get("/v1/me");
    expect(me.ok()).toBe(true);
    expect(((await me.json()) as { email: string }).email).toBe(email);
    const strategies = (await (await page.request.get("/v1/strategies")).json()) as { items: { name: string; status: string }[] };
    expect(strategies.items.map((s) => [s.name, s.status])).toEqual([["Smoke straddle", "paper"]]);
    // sign out
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-logout").click();
    await page.getByRole("button", { name: "Logout", exact: true }).click();
    await page.waitForURL(/\/(auth)?(\?.*)?$/);
    expect((await page.request.get("/v1/me")).status()).toBe(401);
    void request;
  });
});

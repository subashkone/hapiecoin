// Visual captures for comparison with mockup-v2/shots (v2-public-auth-login*.png, qa-dark/analyse.jpg …).
// Saved under e2e/__screenshots__/ in both themes; not pixel-asserted yet (tolerance comes with the spec's visual gate).
import { expect, seedUser, signIn, test } from "./fixtures";

const DIR = "e2e/__screenshots__";

for (const theme of ["dark", "light"] as const) {
  test.describe(`visual · ${theme}`, () => {
    test.use({ colorScheme: theme });

    test(`HC-PB-023 /auth ${theme}`, async ({ page }) => {
      await page.goto("/auth");
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("auth-login")).toBeVisible();
      await expect(page.getByTestId("ticker-BTC")).not.toContainText("—", { timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/auth-login-${theme}.png`, fullPage: true });
      await page.goto("/auth?tab=signup");
      await expect(page.getByTestId("auth-signup")).toBeVisible();
      await page.screenshot({ path: `${DIR}/auth-signup-${theme}.png`, fullPage: true });
    });

    test(`HC-SH-001 /analyse ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `shot-${theme}@example.com`, plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true });
      await signIn(page, `shot-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]$/, { timeout: 15_000 });
      await expect(page.getByTestId("futures-price-value")).not.toHaveText("—", { timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/analyse-${theme}.png` });
      // HC-WS-010 Column Settings dialog over the chain
      await page.getByTestId("chain-columns").click();
      await expect(page.getByTestId("column-settings")).toBeVisible();
      await page.screenshot({ path: `${DIR}/analyse-columns-${theme}.png` });
      await page.getByTestId("columns-done").click();
      // HC-WS-027 a chain holding two legs, with the hover control on the ATM row
      const atmStrike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
      await page.locator(`[data-testid=chain-row-calls][data-strike="${atmStrike}"]`).hover();
      await page.getByTestId("row-buy-calls").click();
      await page.locator(`[data-testid=chain-row-puts][data-strike="${atmStrike}"]`).hover();
      await page.getByTestId("row-sell-puts").click();
      await page.locator(`[data-testid=chain-row-calls][data-strike="${atmStrike}"]`).hover();
      await expect(page.getByTestId("row-controls-calls")).toBeVisible();
      await page.screenshot({ path: `${DIR}/analyse-legs-${theme}.png` });
      // HC-TR-001 / HC-WS-033 the Builder with the two legs and the payoff pane priced
      await page.getByTestId("tab-builder").click();
      await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "2");
      await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("ticket-net")).not.toHaveText("—");
      await page.screenshot({ path: `${DIR}/analyse-builder-${theme}.png` });
      await page.getByTestId("builder-tab-templates").click();
      await expect(page.getByTestId("template-card")).toHaveCount(28);
      await page.screenshot({ path: `${DIR}/analyse-templates-${theme}.png` });
      await page.getByTestId("analysis-tab-greeks").click();
      await expect(page.getByTestId("greek-delta")).not.toContainText("—");
      await page.screenshot({ path: `${DIR}/analyse-greeks-${theme}.png` });
      await page.getByTestId("analysis-tab-payoff").click();
      // HC-TR-058 / HC-TR-068 a paper trade on the Paper tab and its details
      await page.getByTestId("builder-tab-builder").click();
      await page.getByTestId("strategy-name").fill("Visual straddle");
      await page.getByTestId("builder-paper-trade").click();
      await expect(page.getByTestId("trade-mode")).toBeVisible();
      await page.screenshot({ path: `${DIR}/analyse-trade-mode-${theme}.png` });
      await page.getByTestId("trade-continue").click();
      await expect(page.getByTestId("trade-preview")).toBeVisible();
      await page.getByTestId("trade-now").click();
      await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
      await expect(page.getByTestId("paper-card").getByTestId("card-pnl")).not.toHaveText("—");
      await page.screenshot({ path: `${DIR}/analyse-paper-${theme}.png` });
      await page.getByTestId("card-details").click();
      await expect(page.getByTestId("strategy-details")).toBeVisible();
      await page.screenshot({ path: `${DIR}/analyse-details-${theme}.png` });
      await page.keyboard.press("Escape");
      // HC-TR-063 / HC-TR-082 go live: the exchange preview and the Live tab
      await page.getByTestId("card-golive").click();
      await expect(page.getByTestId("trade-mode").getByTestId("mode-live")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("trade-continue").click();
      await expect(page.getByTestId("venue-preview")).toHaveAttribute("data-ok", "true");
      await page.screenshot({ path: `${DIR}/analyse-live-preview-${theme}.png` });
      await page.getByTestId("trade-now").click();
      await expect(page.getByTestId("live-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
      await expect(page.getByTestId("live-card").getByTestId("order-chip").first()).toHaveAttribute("data-state", "filled");
      await page.screenshot({ path: `${DIR}/analyse-live-${theme}.png` });
      await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
      await page.goto("/");
      await expect(page.getByTestId("tile-BTC")).toHaveAttribute("data-state", "live", { timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/home-${theme}.png` });
    });

    test(`HC-AC-037 /referrals and HC-AD-052 admin commissions ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `ref-${theme}@example.com`, role: "admin", referrals: 6 });
      await signIn(page, `ref-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/referrals");
      await expect(page.getByTestId("referrals-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("ref-row")).toHaveCount(6);
      await page.screenshot({ path: `${DIR}/account-referrals-${theme}.png`, fullPage: true });
      await page.getByTestId("ref-share").click();
      await expect(page.getByTestId("share-dialog")).toBeVisible();
      await page.screenshot({ path: `${DIR}/account-referrals-share-${theme}.png` });
      await page.keyboard.press("Escape");
      await page.goto("/admin/subscriptions");
      await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("subs-tab-commissions").click();
      await expect(page.getByTestId("cms-row")).toHaveCount(1);
      await page.screenshot({ path: `${DIR}/admin-commissions-${theme}.png`, fullPage: true });
      await page.getByTestId("cms-mark").click();
      await expect(page.getByTestId("cms-mark-dialog")).toBeVisible();
      await page.screenshot({ path: `${DIR}/admin-commissions-mark-${theme}.png` });
    });
  });
}

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
      await seedUser(request, { email: `shot-${theme}@example.com`, plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
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
      await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
      await page.goto("/");
      await expect(page.getByTestId("tile-BTC")).toHaveAttribute("data-state", "live", { timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/home-${theme}.png` });
    });
  });
}

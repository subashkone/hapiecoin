// My Subscription and the Upgrade Required dialog on the mock API (Phase 4 item 1, ADR-030).
import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-AC My Subscription", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "plans@example.com", plan: { state: "free" } });
    await signIn(page, "plans@example.com");
  });

  test("HC-AC-003 / HC-AC-006 / HC-AC-013 a free user sees limits, the plan grid with the interval toggle and the diff; HC-AC-023 activates the ₹0 plan", async ({ page }) => {
    await page.goto("/subscription");
    await expect(page.getByTestId("subscription-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("sub-none")).toContainText("No Active Subscription");
    await expect(page.locator("[data-testid=limit-row][data-key=paper_trading]")).toContainText("3 / month");
    await expect(page.getByTestId("plan-card")).toHaveCount(4);
    await page.getByTestId("interval-yearly").click();
    await expect(page.getByTestId("plan-card").nth(2).getByTestId("plan-price")).toContainText("₹");
    await page.getByTestId("plan-card").nth(3).click();
    await expect(page.getByTestId("plan-diff")).toContainText("Elite");
    await page.getByTestId("plan-card").nth(0).getByTestId("plan-action").click();
    await expect(page.getByTestId("price-total")).toContainText("₹0");
    await page.getByTestId("subscribe-activate").click();
    await expect(page.getByTestId("sub-plan-name")).toHaveText("Free");
    await expect(page.getByTestId("sub-status")).toHaveAttribute("data-state", "active");
  });

  test("HC-SH-054 the fourth paper trade on the Free plan opens Upgrade Required with the API's reason and links to the plans", async ({ page }) => {
    await page.goto("/analyse");
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    for (let i = 1; i <= 4; i += 1) {
      await page.getByTestId("tab-chain").click();
      await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
      await page.getByTestId("row-buy-calls").click();
      await page.getByTestId("tab-builder").click();
      await page.getByTestId("strategy-name").fill(`Limit test ${i}`);
      await page.getByTestId("builder-paper-trade").click();
      await page.getByTestId("trade-continue").click();
      await page.getByTestId("trade-now").click();
      if (i < 4) await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", String(i), { timeout: 15_000 });
    }
    const dlg = page.getByTestId("upgrade-required");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId("upgrade-message")).toContainText("Your Free plan allows 3 paper trades / month");
    await dlg.getByTestId("upgrade-subscribe").click();
    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByTestId("subscription-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  });
});

test.describe("HC-AC My Referrals", () => {
  test("HC-AC-038 / HC-AC-043 / HC-AC-050 / HC-AC-069 link card, tiles, filters and the Share dialog", async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedUser(request, { email: "ref@example.com", referrals: 6 });
    await signIn(page, "ref@example.com");
    await page.goto("/referrals");
    await expect(page.getByTestId("referrals-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("ref-meta")).toHaveText("20% commission · 6 referrals");
    await expect(page.getByTestId("ref-link")).toHaveValue(/[/]auth[?]tab=signup&ref=ASHA2026$/);
    await page.getByTestId("ref-copy").click();
    await expect(page.getByText("Copied!")).toBeVisible();
    await expect(page.getByTestId("ref-tile").nth(3)).toContainText("₹799.40");
    await expect(page.getByTestId("earnings-bar")).toHaveCount(4);
    await expect(page.getByTestId("ref-row")).toHaveCount(6);
    await page.getByTestId("ref-status-filter").selectOption("pending");
    await expect(page.getByTestId("ref-row")).toHaveCount(3);
    await page.getByTestId("ref-clear").click();
    await expect(page.getByTestId("ref-row")).toHaveCount(6);
    await page.getByTestId("ref-share").click();
    await expect(page.getByTestId("share-dialog")).toBeVisible();
    await expect(page.getByTestId("share-whatsapp")).toContainText("ref=ASHA2026");
  });

  test("HC-AC-051 a trader with no referrals sees the share prompt", async ({ page, request }) => {
    await seedUser(request, { email: "lonely@example.com" });
    await signIn(page, "lonely@example.com");
    await page.goto("/referrals");
    await expect(page.getByTestId("ref-empty")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("earnings-chart")).toHaveCount(0);
  });
});

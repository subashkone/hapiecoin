import { expect, seedUser, signIn, test } from "./fixtures";
import { strikesOf } from "../test/fixtures/chain";

test.describe("HC-SH analyse header and live chain", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "trader@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "trader@example.com");
  });

  test("HC-SH-003 / HC-SH-004 asset switch and live futures price from the gateway", async ({ page }) => {
    const price = page.getByTestId("futures-price-value");
    await expect(price).not.toHaveText("—", { timeout: 15_000 });
    await expect(page.getByText("Futures · BTCUSD")).toBeVisible();
    await expect(page.getByTestId("feed-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("feed-status")).toContainText(/ms/);
    const before = await price.textContent();
    await page.getByTestId("asset-ETH").click();
    await expect(page.getByText("Futures · ETHUSD")).toBeVisible();
    await expect(price).not.toHaveText(before ?? "", { timeout: 15_000 });
    await expect(page.getByTestId("plan-banner")).toContainText("Congratulations! Your plan is active until 31 Dec 2026");
  });

  test("HC-WS-108 chain panel renders the exact strikes the fake gateway serves, with an ATM band", async ({ page }) => {
    const chips = page.getByTestId("expiry-chip");
    await expect(chips.first()).toBeVisible();
    await expect(page.getByText("expiries · gateway")).toBeVisible();
    const table = page.getByTestId("chain-table");
    // The selected chip is the nearest expiry the fake gateway serves; its row count must equal the recorded ladder.
    const selected = await page.locator("[data-testid=expiry-chip][aria-selected=true]").getAttribute("data-expiry");
    const listed = strikesOf("BTC", selected ?? "");
    expect(listed.length).toBeGreaterThan(10);
    await expect(table).toHaveAttribute("data-rows", String(listed.length), { timeout: 15_000 });
    const rendered = await page.getByTestId("chain-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-strike")));
    expect(rendered.length).toBeGreaterThan(10);
    // every rendered strike is one of the recorded instrument-list strikes for that expiry (ADR-006)
    for (const s of rendered) expect(listed).toContain(s);
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1);
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toContainText("ATM · spot");
    // deltas keep flowing: the seq counter advances
    await expect(page.getByText(/seq [1-9]/)).toBeVisible({ timeout: 15_000 });
    await chips.nth(1).click();
    await expect(page.getByTestId("chain-panel")).toHaveAttribute("data-topic", /chain:delta_india:BTC:2026-/);
  });

  test("HC-SH-006 feed status pauses and reconnects", async ({ page }) => {
    const feed = page.getByTestId("feed-status");
    await expect(feed).toHaveAttribute("data-state", "live", { timeout: 15_000 });
    await feed.click();
    await expect(feed).toHaveAttribute("data-state", "paused");
    await expect(page.getByText("Feed paused").first()).toBeVisible();
    await feed.click();
    await expect(feed).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  });

  test("HC-SH-026 logout confirm signs out and returns to the landing page", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-logout").click();
    await expect(page.getByText("Confirm Logout")).toBeVisible();
    await page.getByTestId("logout-confirm").click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/analyse");
    await expect(page).toHaveURL(/\/auth\?next=/);
  });
});

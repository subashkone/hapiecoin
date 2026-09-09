// Market Analytics shell, Markets Hub, Futures overview and coin page (PR 5.2) on the mock API's analytics snapshots.
import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-MA Market Analytics", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "ma@example.com" });
    await signIn(page, "ma@example.com");
  });

  test("HC-MA-001 / HC-MA-003..008 /analytics opens the hub inside the shared shell; sections, search and terminal menu route", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page).toHaveURL(/\/analytics\/hub$/);
    await expect(page.getByTestId("app-header")).toHaveAttribute("data-variant", "default");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Market Analytics");
    await expect(page.getByTestId("section-hub")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("analytics-footer")).toContainText("intervals vary per dataset");
    await page.getByTestId("coin-search").fill("et");
    await expect(page.getByTestId("coin-search-item").first()).toContainText("ETH");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/analytics\/coin\/ETH$/);
    await expect(page.getByTestId("coin-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("coin-oi")).toContainText("$");
    await page.getByTestId("coin-watch").click();
    await expect(page.getByTestId("coin-watch")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("coin-back").click();
    await expect(page).toHaveURL(/\/analytics\/hub$/);
    await expect(page.getByTestId("watch-strip")).toContainText("ETH");
    await page.getByTestId("section-whales").click();
    await expect(page.getByTestId("section-soon")).toHaveAttribute("data-release", "PR 5.4");
    await page.getByTestId("section-terminal").click();
    await page.getByTestId("terminal-menu").getByText("Funding Rates").click();
    await expect(page).toHaveURL(/\/terminal\/derivatives\/funding$/);
    await expect(page.getByTestId("section-soon")).toHaveAttribute("data-release", "PR 5.5");
    await page.getByTestId("analytics-back").click();
    await expect(page).toHaveURL(/\/analyse$/);
  });

  test("HC-MA-012..029 Markets Hub tiles, table tools, tabs and side panels", async ({ page }) => {
    await page.goto("/analytics/hub");
    await expect(page.getByTestId("hub-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("tile-oi")).toContainText("$");
    await expect(page.getByTestId("tile-liq").getByTestId("split")).toBeVisible();
    await expect(page.getByTestId("tile-fg-gauge")).toBeVisible();
    await expect(page.getByTestId("source-line").first()).toContainText("as of");
    const table = page.getByTestId("table-hub-derivatives");
    await expect(table).toHaveAttribute("data-rows", "10");
    await page.getByTestId("th-change24h").click();
    await expect(table).toHaveAttribute("data-sort", "change24h");
    await page.getByTestId("table-search").fill("sol");
    await expect(table).toHaveAttribute("data-rows", "1");
    await page.getByTestId("table-search").fill("");
    await page.getByTestId("table-columns").click();
    await page.getByTestId("col-liq24hUsd").click();
    await expect(page.getByTestId("th-liq24hUsd")).toHaveCount(0);
    await page.getByTestId("table-csv").click();
    await expect(page.getByText("Copied!")).toBeVisible();
    await page.getByTestId("hub-tabs").getByText("Categories").click();
    await expect(page.getByTestId("table-categories")).toBeVisible();
    await page.getByTestId("hub-tabs").getByText("Token Unlock").click();
    await expect(page.getByTestId("hub-main").getByTestId("coming-soon")).toContainText("GAPS #55");
    await page.getByTestId("gl-tabs").getByText("Top Losers").click();
    await expect(page.getByTestId("gl-list")).toBeVisible();
    await expect(page.getByTestId("treemap")).toHaveAttribute("data-count", "10");
    await page.getByTestId("hub-etf").getByText("View all →").click();
    await expect(page.getByTestId("section-soon")).toHaveAttribute("data-release", "PR 5.4");
  });

  test("HC-MA-030..037 Futures overview charts, timeframes, legend, tooltip and gauge", async ({ page }) => {
    await page.goto("/analytics/overview");
    await expect(page.getByTestId("overview-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("tile-btc")).toContainText("$80,000.00");
    const oi = page.getByTestId("chart-oi");
    await expect(oi).toHaveAttribute("data-state", "ready");
    await oi.getByTestId("chart-tf").getByText("7D").click();
    await expect(oi).toHaveAttribute("data-state", "ready");
    const box = (await oi.getByRole("img").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await expect(oi.getByTestId("chart-tip")).toContainText("Open Interest");
    const ls = page.getByTestId("chart-ls");
    await ls.getByTestId("legend-item").first().click();
    await expect(ls.getByTestId("legend-item").first()).toHaveAttribute("data-on", "false");
    await expect(page.getByTestId("fg-gauge")).toBeVisible();
    await expect(page.getByTestId("fg-history")).toContainText("Yesterday");
    await expect(page.getByTestId("table-gainers")).toHaveAttribute("data-rows", "7");
    await expect(page.getByTestId("panel-etf").getByTestId("coming-soon")).toBeVisible();
    await expect(page.getByTestId("overview-footer")).toContainText("auto-refreshing every 60s");
    // palette reaches both pages (HC-MA-092)
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("markets hub");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/analytics\/hub$/);
  });
});

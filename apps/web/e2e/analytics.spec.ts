// Market Analytics shell, Markets Hub, Futures overview, coin page (PR 5.2) and the screener, derivatives and
// liquidations pages (PR 5.3) on the mock API's analytics snapshots.
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
    await expect(page).toHaveURL(/\/analytics\/markets$/);
    await page.getByTestId("section-hub").click();
    await expect(page.getByTestId("watch-strip")).toContainText("ETH", { timeout: 15_000 });
    await page.getByTestId("section-whales").click();
    await expect(page.getByTestId("section-soon")).toHaveAttribute("data-release", "PR 5.4b");
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
    await expect(page.getByTestId("etf-page")).toHaveAttribute("data-state", "soon");
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

  test("HC-MA-038..040 / HC-MA-110..112 Markets screener: category chips, compare, hidden columns and the watchlist chip", async ({ page }) => {
    await page.goto("/analytics/markets?category=layer-1");
    await expect(page.getByTestId("markets-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("section-markets")).toHaveAttribute("aria-current", "page");
    const table = page.getByTestId("table-screener");
    await expect(table).toHaveAttribute("data-rows", "8");
    await expect(page.getByTestId("th-change7d")).toHaveCount(0);
    await page.getByTestId("select-row").nth(0).check();
    await page.getByTestId("select-row").nth(1).check();
    await page.getByTestId("select-row").nth(2).check();
    await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("select-row").nth(3)).toBeDisabled();
    await page.getByTestId("compare-remove").first().click();
    await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "2");
    await page.getByTestId("category-chips").getByText("Memes").click();
    await expect(page).toHaveURL(/category=memes$/);
    await expect(table).toHaveAttribute("data-rows", "1");
    await page.getByTestId("category-chips").getByText("All").click();
    await expect(table).toHaveAttribute("data-rows", "10");
    await page.getByTestId("watch-only").click();
    await expect(page.getByText("Your watchlist is empty")).toBeVisible();
    await page.getByTestId("watch-only").click();
    await page.getByTestId("table-search").fill("sol");
    await expect(table).toHaveAttribute("data-rows", "1");
    await page.getByTestId("table-row").first().click();
    await expect(page).toHaveURL(/\/analytics\/coin\/SOL$/);
    await page.getByTestId("coin-compare").click();
    await expect(page).toHaveURL(/\/analytics\/markets\?compare=SOL$/);
    await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "1");
  });

  test("HC-MA-041..048 / HC-MA-113 Derivatives: coin selector, tiles, four timeframe charts, basis placeholder and the arbitrage table", async ({ page }) => {
    await page.goto("/analytics/derivatives");
    await expect(page.getByTestId("derivatives-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("tile-oi")).toContainText("$8.40B");
    await expect(page.getByTestId("tile-funding")).toContainText("APR");
    for (const id of ["chart-px", "chart-oi", "chart-funding", "chart-ls"]) await expect(page.getByTestId(id)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("panel-basis").getByTestId("coming-soon")).toContainText("GAPS #57");
    await expect(page.getByTestId("arb-count")).toHaveText("10 of 10 coins", { timeout: 15_000 });
    await page.getByTestId("chart-funding").getByTestId("chart-tf").getByText("7D").click();
    await expect(page.getByTestId("chart-funding")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("coin-select").selectOption("ETH");
    await expect(page).toHaveURL(/symbol=ETH$/);
    await expect(page.getByTestId("tile-oi")).toContainText("$3.10B", { timeout: 15_000 });
    await page.getByText("Full coin analytics →").click();
    await expect(page).toHaveURL(/\/analytics\/coin\/ETH$/);
  });

  test("HC-MA-060..066 / HC-MA-116 Liquidations: tiles, window chips, exchange bars, top coins and the feed filter; coin charts and tables", async ({ page }) => {
    await page.goto("/analytics/liquidations");
    await expect(page.getByTestId("liquidations-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("tile-ratio")).toContainText("top coin BTC");
    await expect(page.getByTestId("chart-liq")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("liq-window").getByText("1h").click();
    await expect(page.getByTestId("panel-liq")).toContainText("1h Liquidations Over Time");
    await expect(page.getByTestId("liq-exchanges")).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("table-liq-top")).toHaveAttribute("data-rows", "10");
    await expect(page.getByTestId("liq-feed")).toHaveAttribute("data-rows", "40");
    await page.getByTestId("liq-min").selectOption("500000");
    await expect(page.getByTestId("liq-feed")).not.toHaveAttribute("data-rows", "40");
    await page.getByTestId("table-search").fill("btc");
    await expect(page.getByTestId("table-liq-top")).toHaveAttribute("data-rows", "1");
    await page.getByTestId("table-row").first().click();
    await expect(page).toHaveURL(/\/analytics\/coin\/BTC$/);
    await expect(page.getByTestId("coin-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    for (const id of ["chart-pxoi", "chart-ls", "chart-funding", "chart-taker"]) await expect(page.getByTestId(id)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("liq-heatmap")).toBeVisible();
    await expect(page.getByTestId("table-coin-markets")).toHaveAttribute("data-rows", "3");
    await expect(page.getByTestId("table-coin-funding")).toHaveAttribute("data-rows", "3");
    await page.getByTestId("chart-pxoi").getByTestId("chart-tf").getByText("1D").click();
    await expect(page.getByTestId("chart-pxoi")).toHaveAttribute("data-state", "ready");
    // palette reaches the new pages (HC-MA-092)
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("liquidations");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/analytics\/liquidations$/);
  });

  test("HC-MA-049..053 / HC-MA-114 Options: exchange toggle, tiles, expiry chart with max pain, donut and table; ETF coming soon", async ({ page }) => {
    await page.goto("/analytics/options");
    await expect(page.getByTestId("options-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("section-options")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tile-maxpain")).toContainText("$");
    await expect(page.getByTestId("chart-expiry")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("chart-expiry").getByTestId("chart-label")).toHaveCount(8);
    await expect(page.getByTestId("donut")).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("table-options-exchanges")).toHaveAttribute("data-rows", "2");
    await page.getByTestId("options-exchange").getByText("Delta India").click();
    await expect(page).toHaveURL(/exchange=delta$/);
    await expect(page.getByTestId("options-page")).toHaveAttribute("data-exchange", "delta");
    await page.getByTestId("options-symbol").selectOption("ETH");
    await expect(page).toHaveURL(/symbol=ETH&exchange=delta$/);
    await expect(page.getByTestId("tile-oi")).toContainText("$", { timeout: 15_000 });
    await page.getByTestId("section-etf").click();
    await expect(page.getByTestId("etf-page")).toHaveAttribute("data-state", "soon");
    await page.getByTestId("etf-asset").getByText("Ethereum").click();
    await expect(page.getByTestId("etf-page")).toHaveAttribute("data-asset", "ethereum");
    await expect(page.getByTestId("etf-page").getByTestId("coming-soon")).toHaveCount(4);
  });

  test("HC-MA-073..081 / HC-MA-118, 119 Sentiment: gauge, checklist, cycle charts, premium and the RSI screener", async ({ page }) => {
    await page.goto("/analytics/sentiment");
    await expect(page.getByTestId("sentiment-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("fg-gauge")).toBeVisible();
    await expect(page.getByTestId("chart-fg").getByTestId("chart-band")).toHaveCount(4);
    await expect(page.getByTestId("check-summary")).toContainText("triggered", { timeout: 15_000 });
    await expect(page.getByTestId("check-row")).toHaveCount(8);
    for (const id of ["chart-pi", "chart-rainbow", "chart-ma2", "chart-premium"]) await expect(page.getByTestId(id)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("chart-rainbow").getByTestId("chart-region")).toHaveCount(9);
    await page.getByTestId("cycle-tf").getByText("30D").click();
    await expect(page.getByTestId("chart-pi")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("chart-premium").getByTestId("chart-tf").getByText("7D").click();
    await expect(page.getByTestId("chart-premium")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("panel-ahr").getByTestId("coming-soon")).toContainText("GAPS #59");
    await expect(page.getByTestId("table-rsi")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
    await page.getByTestId("th-rsi_4h").click();
    await expect(page.getByTestId("table-rsi")).toHaveAttribute("data-sort", "rsi_4h");
    await page.getByTestId("table-search").fill("eth");
    await expect(page.getByTestId("table-rsi")).toHaveAttribute("data-rows", "1");
    await page.getByTestId("table-row").first().click();
    await expect(page).toHaveURL(/\/analytics\/coin\/ETH$/);
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("sentiment");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/analytics\/sentiment$/);
  });
});

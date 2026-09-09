// Market Analytics terminal (PR 5.5): the sidebar shell, dashboard, spot / sectors / exchanges, the derivatives,
// indicator and on-chain screens, and the coin page in terminal mode, on the mock API's analytics snapshots.
import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-MT Market Analytics terminal", () => {
  test("HC-MT-038 logged-out visitors are sent to /auth", async ({ page }) => {
    await page.goto("/terminal/spot");
    await expect(page).toHaveURL(/\/auth\?next=%2Fterminal$/);
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ page, request }) => {
      await seedUser(request, { email: "mt@example.com" });
      await signIn(page, "mt@example.com");
    });

    test("HC-MT-001..030, 040..051, 156..158 shell, sidebar, dashboard, watchlist and the coin search", async ({ page }) => {
      await page.goto("/terminal");
      await expect(page.getByTestId("terminal-shell")).toHaveAttribute("data-section", "Dashboard");
      await expect(page.getByTestId("section-terminal")).toHaveClass(/bg-muted/);
      await expect(page.getByTestId("tnav-dashboard")).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("dashboard-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("tile-oi")).toContainText("$");
      await expect(page.getByTestId("chart-oi")).toHaveAttribute("data-state", "ready");
      await expect(page.getByTestId("table-dash-markets")).toHaveAttribute("data-rows", "10");
      await expect(page.getByTestId("watch-empty")).toBeVisible();
      await page.getByTestId("table-dash-markets").getByTestId("star").nth(2).click();
      await expect(page.getByTestId("watch-strip")).toHaveAttribute("data-count", "1");
      await page.getByTestId("watch-card").getByRole("link").click();
      await expect(page).toHaveURL(/\/terminal\/coin\/[A-Z]+$/);
      await expect(page.getByTestId("coin-page")).toHaveAttribute("data-base", "terminal");
      await expect(page.getByTestId("terminal-shell")).toHaveAttribute("data-section", "Coin");
      await page.getByTestId("coin-back").click();
      await expect(page).toHaveURL(/\/terminal$/);
      // header search opens the terminal coin page; no match → toast
      await page.getByTestId("coin-search").fill("et");
      await expect(page.getByTestId("coin-search-hint")).toContainText("terminal");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/terminal\/coin\/ETH$/);
      await expect(page.getByTestId("coin-sector")).toHaveAttribute("href", "/terminal/sectors/layer-1");
      await page.getByTestId("coin-search").fill("zzzz");
      await expect(page.getByTestId("coin-search-empty")).toContainText("No coin matches");
      await page.keyboard.press("Enter");
      await expect(page.getByText("No coin matches “zzzz”").first()).toBeVisible();
      // the Markets Hub item leaves the terminal
      await page.getByTestId("tnav-hub").click();
      await expect(page).toHaveURL(/\/analytics\/hub$/);
    });

    test("HC-MT-052..067, 102..113, 159..166 spot markets with compare, sectors and exchanges", async ({ page }) => {
      await page.goto("/terminal/spot?compare=BTC");
      await expect(page.getByTestId("spot-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("spot-counter")).toHaveText("10 markets");
      await expect(page.getByTestId("table-spot")).toHaveAttribute("data-rows", "10");
      await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "1");
      await page.getByTestId("select-row").nth(1).click();
      await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "2");
      await page.getByTestId("table-search").fill("sol");
      await expect(page.getByTestId("table-spot")).toHaveAttribute("data-rows", "1");
      await page.getByTestId("table-search").fill("");
      await page.getByTestId("th-oiShare").click();
      await expect(page.getByTestId("table-spot")).toHaveAttribute("data-sort", "oiShare");
      await page.getByTestId("tnav-sectors-memes").click();
      await expect(page).toHaveURL(/\/terminal\/sectors\/memes$/);
      await expect(page.getByTestId("sector-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("sector-chips").getByText("DeFi").click();
      await expect(page).toHaveURL(/\/terminal\/sectors\/defi$/);
      await page.goto("/terminal/sectors");
      await expect(page).toHaveURL(/\/terminal\/sectors\/layer-1$/);
      await page.goto("/terminal/sectors/xyz");
      await expect(page.getByTestId("sector-unknown")).toContainText("Unknown sector: xyz");
      await page.getByTestId("tnav-exchanges").click();
      await expect(page).toHaveURL(/\/terminal\/exchanges\/binance$/);
      await expect(page.getByTestId("exchange-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("tile-coins")).toContainText("10");
      await expect(page.getByTestId("table-exchange-coins")).toHaveAttribute("data-rows", "10");
      await page.getByTestId("exchange-chips").getByText("Bybit").click();
      await expect(page).toHaveURL(/\/terminal\/exchanges\/bybit$/);
      await expect(page.getByTestId("exchange-page")).toHaveAttribute("data-exchange", "bybit");
      await page.getByTestId("table-exchange-coins").getByTestId("table-row").first().click();
      await expect(page).toHaveURL(/\/terminal\/coin\/[A-Z]+$/);
      await page.goto("/terminal/exchanges/kraken");
      await expect(page.getByTestId("exchange-page")).toHaveAttribute("data-state", "unknown", { timeout: 15_000 });
    });

    test("HC-MT-114..150, 167..174 derivatives, indicators and on-chain screens", async ({ page }) => {
      await page.goto("/terminal/derivatives/open-interest");
      await expect(page.getByTestId("oi-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("table-oi-exchanges")).toHaveAttribute("data-rows", "3", { timeout: 15_000 });
      await expect(page.getByTestId("chart-oi")).toHaveAttribute("data-state", "ready");
      await page.getByTestId("tnav-derivatives-funding").click();
      await expect(page.getByTestId("funding-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("table-funding-venues")).toHaveAttribute("data-rows", "3");
      await page.getByTestId("coin-select").selectOption("ETH");
      await expect(page.getByTestId("funding-page")).toHaveAttribute("data-symbol", "ETH");
      await expect(page.getByTestId("chart-funding")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("chart-tf").getByText("7D").click();
      await page.getByTestId("tnav-derivatives-long-short").click();
      await expect(page.getByTestId("ls-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("table-ls-readings")).toHaveAttribute("data-rows", "24");
      await expect(page.getByTestId("chart-ls").getByTestId("legend-item")).toHaveCount(3);
      await page.getByTestId("tnav-derivatives-liquidations").click();
      await expect(page.getByTestId("liq-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("liq-window").getByText("4h", { exact: true }).click();
      await expect(page.getByTestId("chart-liq")).toHaveAttribute("data-state", "ready");
      await page.getByTestId("tnav-indicators-fear-greed").click();
      await expect(page.getByTestId("fg-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("fg-gauge")).toBeVisible();
      await expect(page.getByTestId("tile-month")).not.toContainText("—");
      await page.getByTestId("tnav-indicators-cycle").click();
      await expect(page.getByTestId("cycle-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("chart-pi")).toHaveAttribute("data-state", "ready");
      await expect(page.getByTestId("coming-soon")).toHaveCount(2);
      await page.getByTestId("tnav-onchain-exchange-balance").click();
      await expect(page.getByTestId("balance-page")).toHaveAttribute("data-state", "soon");
      await page.getByTestId("tnav-onchain-unlocks").click();
      await expect(page.getByTestId("unlocks-note")).toContainText("no mock data shown");
      await page.getByTestId("tnav-etf").click();
      await expect(page.getByTestId("etf-page")).toHaveAttribute("data-state", "soon");
      // the drawer under the lg breakpoint names the section and closes on navigation
      await page.setViewportSize({ width: 800, height: 900 });
      await expect(page.getByTestId("terminal-nav")).toBeHidden();
      await page.getByTestId("terminal-nav-toggle").click();
      await expect(page.getByTestId("terminal-nav")).toBeVisible();
      await page.getByTestId("tnav-dashboard").click();
      await expect(page).toHaveURL(/\/terminal$/);
      await expect(page.getByTestId("terminal-nav")).toBeHidden();
      await expect(page.getByTestId("terminal-nav-current")).toHaveText("Dashboard");
    });
  });
});

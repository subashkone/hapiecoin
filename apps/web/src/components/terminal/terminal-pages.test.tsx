// Terminal shell and screens (HC-MT-001..174) against the mock API's analytics snapshots: sidebar groups and the
// active rule, dashboard tiles / watchlist / tables, spot screener with compare, sectors, exchanges, the four
// derivatives pages, Fear & Greed, BTC cycle, the two on-chain placeholders and the coin page in terminal mode.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock, routerMock, searchParamsMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { AnalyticsShell } from "@/components/analytics/AnalyticsShell";
import { CoinPage } from "@/components/analytics/CoinPage";
import { FundingPage, LongShortPage, OpenInterestPage, TerminalLiquidationsPage } from "./DerivativesPages";
import { BalancePage, CyclePage, FearGreedPage, UnlocksPage } from "./IndicatorPages";
import { DashboardPage, ExchangePage, SectorPage, SpotPage } from "./MarketPages";
import { TerminalShell } from "./TerminalShell";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ watchlist: [] });
  searchParamsMock.value = new URLSearchParams();
  routerMock.push.mockClear();
});
afterEach(() => mock.restore());

const ready = async (id: string, state = "ready") => {
  await waitFor(() => expect(screen.getByTestId(id).dataset["state"]).toBe(state), { timeout: 6000 });
};

describe("HC-MT-001, 011..030, 152..155 terminal shell", () => {
  it("renders the grouped sidebar with the active rule, the external hub marker and the mobile drawer", async () => {
    pathnameMock.value = "/terminal/sectors/defi";
    renderWithProviders(
      <AnalyticsShell>
        <TerminalShell>
          <div data-testid="child">child</div>
        </TerminalShell>
      </AnalyticsShell>,
    );
    expect(screen.getByTestId("terminal-shell").dataset["section"]).toBe("DeFi");
    const nav = screen.getByTestId("terminal-nav");
    expect(within(nav).getAllByRole("link")).toHaveLength(17);
    expect(screen.getByTestId("tnav-sectors-defi").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("tnav-spot").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("tnav-hub").getAttribute("href")).toBe("/analytics/hub");
    expect(screen.getByTestId("tnav-hub").textContent).toContain("↗");
    expect(screen.getByTestId("tnav-dashboard").getAttribute("href")).toBe("/terminal");
    expect(screen.getByTestId("section-terminal").className).toContain("bg-muted");
    expect(screen.getByTestId("terminal-nav-current").textContent).toBe("DeFi");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("terminal-nav-toggle"));
    expect(nav.dataset["open"]).toBe("true");
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.getByTestId("analytics-footer").textContent).toContain("intervals vary per dataset");
  });
  it("the coin search opens the terminal coin page and says so", async () => {
    pathnameMock.value = "/terminal";
    renderWithProviders(
      <AnalyticsShell>
        <TerminalShell>
          <div />
        </TerminalShell>
      </AnalyticsShell>,
    );
    const u = userEvent.setup();
    await u.type(screen.getByTestId("coin-search"), "et");
    await waitFor(() => expect(screen.getAllByTestId("coin-search-item").length).toBeGreaterThan(0), { timeout: 6000 });
    expect(screen.getByTestId("coin-search-list").dataset["base"]).toBe("/terminal/coin");
    expect(screen.getByTestId("coin-search-hint").textContent).toContain("terminal");
    await u.keyboard("{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith("/terminal/coin/ETH");
  });
});

describe("HC-MT-040..051, 156..158 dashboard", () => {
  it("tiles, watchlist strip, charts, gainers / losers and the markets table", async () => {
    pathnameMock.value = "/terminal";
    renderWithProviders(<DashboardPage />);
    await ready("dashboard-page");
    expect(screen.getByTestId("tile-oi").textContent).toContain("$");
    expect(screen.getByTestId("tile-dom").textContent).toMatch(/\d+\.\d%/);
    expect(screen.getByTestId("tile-etf").textContent).toContain("GAPS #55");
    expect(screen.getByTestId("tile-ls").textContent).toMatch(/\d\.\d\d/);
    expect(screen.getByTestId("watch-empty")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("chart-oi").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("chart-ls").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("table-gainers").dataset["rows"]).toBe("6");
    expect(screen.getByTestId("table-losers").dataset["rows"]).toBe("6");
    const markets = screen.getByTestId("table-dash-markets");
    expect(markets.dataset["rows"]).toBe("10");
    expect(markets.dataset["sort"]).toBe("oiUsd");
    expect(screen.queryByTestId("th-funding")).toBeNull();
    // star a row → a watchlist card with its sparkline; ★ on the card removes it again
    const u = userEvent.setup();
    await u.click(within(markets).getAllByTestId("star")[1]!);
    expect(screen.getByTestId("watch-strip").dataset["count"]).toBe("1");
    expect(screen.getByTestId("watch-card").querySelector("polyline")).toBeTruthy();
    await u.click(screen.getByTestId("watch-remove"));
    expect(screen.getByTestId("watch-empty")).toBeTruthy();
    // a row opens the terminal coin page
    await u.click(within(screen.getByTestId("table-gainers")).getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/terminal\/coin\/[A-Z]+$/));
  });
});

describe("HC-MT-052..067, 159..162 spot markets and sectors", () => {
  it("spot: counter, OI share column, hidden columns, compare from the query and the watchlist chip", async () => {
    pathnameMock.value = "/terminal/spot";
    searchParamsMock.value = new URLSearchParams("compare=btc,eth");
    renderWithProviders(<SpotPage />);
    await ready("spot-page");
    expect(screen.getByTestId("spot-counter").textContent).toBe("10 markets");
    const table = screen.getByTestId("table-spot");
    await waitFor(() => expect(table.dataset["rows"]).toBe("10"));
    expect(table.dataset["sort"]).toBe("marketCap");
    expect(screen.getByTestId("th-oiShare")).toBeTruthy();
    expect(screen.queryByTestId("th-lsRatio")).toBeNull();
    expect(screen.getByTestId("compare-grid").dataset["count"]).toBe("2");
    expect(screen.getByTestId("spot-count").textContent).toContain("10 markets");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("watch-only"));
    expect(screen.getByText(/Your watchlist is empty/)).toBeTruthy();
    act(() => useUiStore.getState().toggleWatch("SOL"));
    expect(table.dataset["rows"]).toBe("1");
    fireEvent.change(screen.getByTestId("table-search"), { target: { value: "zzz" } });
    expect(table.dataset["rows"]).toBe("0");
  });
  it("sectors: chips switch the route, the table filters by sector, an unknown slug says so", async () => {
    pathnameMock.value = "/terminal/sectors/layer-1";
    const r = renderWithProviders(<SectorPage slug="layer-1" />);
    await ready("sector-page");
    await waitFor(() => expect(screen.getByTestId("table-sector").dataset["rows"]).toBe("8"));
    expect(screen.getByText("Layer-1 Sector")).toBeTruthy();
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("sector-chips")).getByText("Memes"));
    expect(routerMock.push).toHaveBeenCalledWith("/terminal/sectors/memes");
    r.unmount();
    renderWithProviders(<SectorPage slug="xyz" />);
    expect(screen.getByTestId("sector-page").dataset["state"]).toBe("unknown");
    expect(screen.getByTestId("sector-unknown").textContent).toContain("Unknown sector: xyz");
  });
});

describe("HC-MT-102..113, 166 exchange overview", () => {
  it("sums the venue over the tracked coins, lists its coins, switches venues and handles an unknown one", async () => {
    pathnameMock.value = "/terminal/exchanges/binance";
    const r = renderWithProviders(<ExchangePage exchange="binance" />);
    await ready("exchange-page");
    expect(screen.getByTestId("tile-coins").textContent).toContain("10");
    expect(screen.getByTestId("tile-oi").textContent).toMatch(/\d+\.\d% of aggregated OI/);
    expect(screen.getByTestId("tile-vol").textContent).toContain("GAPS #63");
    expect(screen.getByTestId("table-exchange-coins").dataset["rows"]).toBe("10");
    expect(screen.queryByTestId("th-apr")).toBeNull();
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("exchange-chips")).getByText("OKX"));
    expect(routerMock.push).toHaveBeenCalledWith("/terminal/exchanges/okx");
    r.unmount();
    renderWithProviders(<ExchangePage exchange="kraken" />);
    await ready("exchange-page", "unknown");
    expect(screen.getByTestId("exchange-unknown").textContent).toContain("Binance");
  });
});

describe("HC-MT-114..134, 167..170 derivatives pages", () => {
  it("open interest: tiles, the dual-axis chart and the per-exchange shares", async () => {
    renderWithProviders(<OpenInterestPage />);
    await ready("oi-page");
    await waitFor(() => expect(screen.getByTestId("table-oi-exchanges").dataset["rows"]).toBe("3"), { timeout: 6000 });
    expect(screen.getByTestId("tile-top").textContent).toMatch(/Binance|Bybit|OKX/);
    expect(screen.getByTestId("tile-btc").textContent).toContain("dominance");
    await waitFor(() => expect(screen.getByTestId("chart-oi").dataset["state"]).toBe("ready"));
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("table-oi-exchanges")).getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/terminal\/exchanges\/(binance|bybit|okx)$/));
  });
  it("funding: tiles, the sign-coloured bars, the venue table and the coin selector", async () => {
    renderWithProviders(<FundingPage />);
    await ready("funding-page");
    expect(screen.getByTestId("tile-weighted").textContent).toContain("%");
    expect(screen.getByTestId("tile-avg").textContent).toContain("3 venues");
    expect(screen.getByTestId("tile-apr").textContent).toContain("%");
    await waitFor(() => expect(screen.getByTestId("chart-funding").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("table-funding-venues").dataset["rows"]).toBe("3");
    expect(screen.getByTestId("th-apr")).toBeTruthy();
    fireEvent.change(screen.getByTestId("coin-select"), { target: { value: "ETH" } });
    expect(screen.getByTestId("funding-page").dataset["symbol"]).toBe("ETH");
    await ready("funding-page");
  });
  it("long / short: three ratio tiles, the three-line chart and 24 hourly readings", async () => {
    renderWithProviders(<LongShortPage />);
    await ready("ls-page");
    expect(screen.getByTestId("tile-global").textContent).toMatch(/\d\.\d{3}/);
    expect(screen.getByTestId("tile-top-positions").textContent).toMatch(/\d\.\d{3}/);
    await waitFor(() => expect(screen.getByTestId("chart-ls").dataset["state"]).toBe("ready"));
    expect(within(screen.getByTestId("chart-ls")).getAllByTestId("legend-item")).toHaveLength(3);
    expect(screen.getByTestId("table-ls-readings").dataset["rows"]).toBe("24");
  });
  it("liquidations: tiles, window chips and the by-coin table", async () => {
    renderWithProviders(<TerminalLiquidationsPage />);
    await ready("liq-page");
    expect(screen.getByTestId("tile-total").textContent).toContain("$");
    expect(screen.getByTestId("tile-largest").textContent).toMatch(/[A-Z]{3}/);
    // app-wide colours: long liquidations green, short red (ADR-046)
    expect(screen.getByTestId("tile-long").querySelector(".text-profit")).toBeTruthy();
    expect(screen.getByTestId("tile-short").querySelector(".text-loss")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("chart-liq").dataset["state"]).toBe("ready"));
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("liq-window")).getByText("1h"));
    expect(screen.getByTestId("panel-liq").textContent).toContain("re-binned");
    expect(Number(screen.getByTestId("table-liq-coins").dataset["rows"])).toBeGreaterThan(0);
    expect(screen.getByTestId("table-liq-coins").dataset["sort"]).toBe("total");
  });
});

describe("HC-MT-135..150, 171..174 indicators and on-chain", () => {
  it("fear & greed: gauge, history with the extreme lines and the four lookback tiles", async () => {
    renderWithProviders(<FearGreedPage />);
    await ready("fg-page");
    expect(Number(screen.getByTestId("fg-gauge").dataset["value"])).toBeGreaterThanOrEqual(0);
    expect(screen.getByTestId("fg-label").textContent).toMatch(/Fear|Neutral|Greed/);
    await waitFor(() => expect(screen.getByTestId("chart-fg").dataset["state"]).toBe("ready"));
    for (const id of ["now", "yesterday", "week", "month"]) expect(screen.getByTestId(`tile-${id}`).textContent).toMatch(/\d/);
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("chart-tf")).getByText("7D"));
    expect(within(screen.getByTestId("chart-tf")).getByText("7D").getAttribute("aria-selected")).toBe("true");
  });
  it("cycle: Pi Cycle and the rainbow band from the dataset, AHR999 and Puell as placeholders", async () => {
    renderWithProviders(<CyclePage />);
    await ready("cycle-page");
    expect(screen.getByTestId("tile-ahr").textContent).toContain("n/a");
    expect(screen.getByTestId("tile-pi").textContent).toContain("/");
    expect(screen.getByTestId("tile-rainbow").textContent).not.toContain("—");
    await waitFor(() => expect(screen.getByTestId("chart-pi").dataset["state"]).toBe("ready"));
    expect(screen.getAllByTestId("coming-soon")).toHaveLength(2);
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("cycle-tf")).getByText("30D"));
    expect(within(screen.getByTestId("cycle-tf")).getByText("30D").getAttribute("aria-selected")).toBe("true");
  });
  it("exchange balance and token unlocks are honest placeholders", () => {
    const r = renderWithProviders(<BalancePage />);
    expect(screen.getByTestId("balance-page").dataset["state"]).toBe("soon");
    expect(screen.getByTestId("coming-soon").textContent).toContain("GAPS #55");
    r.unmount();
    renderWithProviders(<UnlocksPage />);
    expect(screen.getByTestId("unlocks-note").textContent).toBe("This data source is not enabled on the current plan. Enable a token-unlock endpoint in the proxy to populate this view — no mock data shown.");
  });
});

describe("HC-MT-080..101, 164, 165 coin page in the terminal", () => {
  it("links back to the dashboard, into the sector, compares in Spot Markets and opens exchanges from the venue tables", async () => {
    pathnameMock.value = "/terminal/coin/BTC";
    renderWithProviders(<CoinPage symbol="btc" base="terminal" />);
    await ready("coin-page");
    expect(screen.getByTestId("coin-page").dataset["base"]).toBe("terminal");
    expect(screen.getByTestId("coin-back").getAttribute("href")).toBe("/terminal");
    expect(screen.getByTestId("coin-rank").textContent).toBe("Rank #1");
    expect(screen.getByTestId("coin-sector").getAttribute("href")).toBe("/terminal/sectors/layer-1");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("coin-compare"));
    expect(routerMock.push).toHaveBeenCalledWith("/terminal/spot?compare=BTC");
    await waitFor(() => expect(screen.getByTestId("table-coin-markets").dataset["rows"]).toBe("3"), { timeout: 6000 });
    await u.click(within(screen.getByTestId("table-coin-markets")).getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/terminal\/exchanges\/(binance|bybit|okx)$/));
    expect(screen.getByTestId("liq-heatmap")).toBeTruthy();
  });
});

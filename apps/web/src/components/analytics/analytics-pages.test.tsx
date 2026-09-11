// Markets screener, Derivatives, Liquidations and the coin page (HC-MA-038..048, 060..066, 084..087, 110..113, 116,
// 121) against the mock API's per-symbol and liquidation snapshots.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock, routerMock, searchParamsMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { CoinPage } from "./CoinPage";
import { DerivativesPage } from "./DerivativesPage";
import { LiquidationsPage } from "./LiquidationsPage";
import { MarketsPage, parseCompare } from "./MarketsPage";
import { CoinSelect, HBars, LiqHeatmap } from "./bits";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ watchlist: [] });
  searchParamsMock.value = new URLSearchParams();
});
afterEach(() => mock.restore());

describe("HC-MA-038..040, 110..112 Futures Markets Screener", () => {
  it("filters by category, compares up to three coins, hides the secondary columns and honours the watchlist chip", async () => {
    pathnameMock.value = "/analytics/markets";
    searchParamsMock.value = new URLSearchParams("category=layer-1&compare=btc,eth,btc");
    renderWithProviders(<MarketsPage />);
    await waitFor(() => expect(screen.getByTestId("markets-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("markets-page").dataset["category"]).toBe("layer-1");
    await waitFor(() => expect(screen.getByTestId("table-screener").dataset["rows"]).toBe("8"));
    expect(screen.getByTestId("compare-grid").dataset["count"]).toBe("2");
    expect(screen.queryByTestId("th-change7d")).toBeNull();
    expect(screen.getByTestId("th-lsRatio")).toBeTruthy();
    expect(screen.getByTestId("screener-foot").textContent).toContain("8 markets");
    const u = userEvent.setup();
    const boxes = screen.getAllByTestId("select-row");
    const third = boxes.find((b) => (b as HTMLInputElement).checked === false)!;
    await u.click(third);
    expect(screen.getByTestId("compare-grid").dataset["count"]).toBe("3");
    const fourth = screen.getAllByTestId("select-row").find((b) => !(b as HTMLInputElement).checked) as HTMLInputElement;
    expect(fourth.disabled).toBe(true);
    await u.click(screen.getAllByTestId("compare-remove")[0]!);
    expect(screen.getByTestId("compare-grid").dataset["count"]).toBe("2");
    await u.click(screen.getByTestId("compare-clear"));
    expect(screen.queryByTestId("compare-panel")).toBeNull();
    await u.click(within(screen.getByTestId("category-chips")).getByText("Memes"));
    expect(routerMock.push).toHaveBeenCalledWith("/analytics/markets?category=memes");
    await u.click(within(screen.getByTestId("category-chips")).getByText("All"));
    expect(routerMock.push).toHaveBeenCalledWith("/analytics/markets");
    await u.click(screen.getByTestId("watch-only"));
    expect(screen.getByText(/Your watchlist is empty/)).toBeTruthy();
    act(() => useUiStore.getState().toggleWatch("ETH"));
    expect(screen.getByTestId("table-screener").dataset["rows"]).toBe("1");
    await u.click(screen.getByTestId("watch-only"));
    await u.click(screen.getByTestId("table-columns"));
    await u.click(screen.getByTestId("col-change7d"));
    expect(screen.getByTestId("th-change7d")).toBeTruthy();
  });
  it("parses the compare param and shows the CoinGecko notice when the markets dataset is missing", async () => {
    expect(parseCompare("btc, eth,btc,sol,xrp")).toEqual(["BTC", "ETH", "SOL"]);
    expect(parseCompare(null)).toEqual([]);
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      searchParamsMock.value = new URLSearchParams("compare=BTC&category=bogus");
      renderWithProviders(<MarketsPage />);
      await waitFor(() => expect(screen.getByTestId("markets-page").dataset["state"]).toBe("unavailable"), { timeout: 4000 });
      expect(screen.getByTestId("markets-page").dataset["category"]).toBe("all");
      expect(screen.getByTestId("coming-soon").textContent).toContain("Needs CoinGecko");
      expect(screen.getByTestId("compare-grid").dataset["count"]).toBe("0");
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-041..048, 113 Derivatives", () => {
  it("renders the tiles, four timeframe charts, the basis placeholder and the arbitrage table; the selector switches coin", async () => {
    pathnameMock.value = "/analytics/derivatives";
    renderWithProviders(<DerivativesPage />);
    await waitFor(() => expect(screen.getByTestId("derivatives-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-oi").textContent).toContain("$8.40B");
    expect(screen.getByTestId("tile-funding").textContent).toContain("APR");
    expect(screen.getByTestId("tile-ls").textContent).toContain("Global accounts");
    await waitFor(() => expect(screen.getByTestId("tile-vol").textContent).toContain("Perp taker"));
    for (const id of ["chart-px", "chart-oi", "chart-funding", "chart-ls"]) await waitFor(() => expect(screen.getByTestId(id).dataset["state"]).toBe("ready"));
    expect(within(screen.getByTestId("chart-px")).getByTestId("chart-tf").textContent).toBe("1D7D");
    expect(within(screen.getByTestId("panel-basis")).getByTestId("coming-soon").textContent).toContain("GAPS #57");
    await waitFor(() => expect(screen.getByTestId("arb-count").textContent).toBe("10 of 10 coins"), { timeout: 4000 });
    expect(screen.getByTestId("table-arb").dataset["rows"]).toBe("10");
    expect(screen.getAllByTestId("table-row")[0]?.textContent).toContain("Long");
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("chart-funding")).getByText("7D"));
    expect(screen.getByTestId("chart-funding").dataset["state"]).toBe("ready");
    await u.selectOptions(screen.getByTestId("coin-select"), "ETH");
    expect(screen.getByTestId("derivatives-page").dataset["symbol"]).toBe("ETH");
    expect(routerMock.replace).toHaveBeenCalledWith("/analytics/derivatives?symbol=ETH");
    await waitFor(() => expect(screen.getByTestId("tile-oi").textContent).toContain("$3.10B"), { timeout: 4000 });
  });
  it("says when a coin has no derivatives snapshot", async () => {
    searchParamsMock.value = new URLSearchParams("symbol=zzz");
    renderWithProviders(<DerivativesPage />);
    await waitFor(() => expect(screen.getByTestId("derivatives-page").dataset["state"]).toBe("unavailable"), { timeout: 4000 });
    expect(screen.getByTestId("derivatives-unavailable").textContent).toContain("ZZZ");
    expect(screen.getByTestId("tile-vol").textContent).toContain("waiting for taker volume");
    // the chart draws its empty state a tick after the page state flips; wait for it (a CI runner is slower than a laptop)
    expect((await within(screen.getByTestId("chart-ls")).findByTestId("chart-empty", {}, { timeout: 4000 })).textContent).toContain("Binance");
  });
});

describe("HC-MA-060..066, 116 Liquidations", () => {
  it("renders tiles, the windowed chart, exchange bars, the top-coins table and the feed with its Min USD filter", async () => {
    pathnameMock.value = "/analytics/liquidations";
    renderWithProviders(<LiquidationsPage />);
    await waitFor(() => expect(screen.getByTestId("liquidations-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-long").textContent).toContain("% of total");
    expect(screen.getByTestId("tile-ratio").textContent).toContain("top coin BTC");
    expect(screen.getByTestId("chart-liq").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("liq-exchanges").dataset["count"]).toBe("3");
    expect(screen.getByTestId("table-liq-top").dataset["rows"]).toBe("10");
    expect(screen.getByTestId("liq-feed").dataset["rows"]).toBe("40");
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("liq-window")).getByText("1h"));
    expect(screen.getByTestId("panel-liq").textContent).toContain("1h Liquidations Over Time");
    expect(screen.getByTestId("panel-liq").textContent).toContain("from the newest events");
    await u.click(within(screen.getByTestId("liq-window")).getByText("4h"));
    expect(screen.getByTestId("chart-liq").dataset["state"]).toBe("ready");
    await u.type(screen.getByTestId("table-search"), "eth");
    expect(screen.getByTestId("table-liq-top").dataset["rows"]).toBe("1");
    await u.selectOptions(screen.getByTestId("liq-min"), "500000");
    expect(Number(screen.getByTestId("liq-feed").dataset["rows"])).toBeLessThan(40);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await u.click(screen.getByTestId("table-csv"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await u.click(screen.getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith("/analytics/coin/ETH");
  });
  it("shows the empty feed and the unavailable notice", async () => {
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      renderWithProviders(<LiquidationsPage />);
      await waitFor(() => expect(screen.getByTestId("liquidations-page").dataset["state"]).toBe("unavailable"), { timeout: 4000 });
      expect(screen.getByTestId("liquidations-unavailable")).toBeTruthy();
      expect(screen.getByTestId("liq-feed-empty").textContent).toContain("No liquidations captured yet");
      expect(screen.getByTestId("liq-exchanges").textContent).toContain("No venue has reported yet");
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-084..087, 121 coin page", () => {
  it("draws the five charts with timeframes, the heatmap and both per-exchange tables", async () => {
    pathnameMock.value = "/analytics/coin/BTC";
    renderWithProviders(<CoinPage symbol="btc" />);
    await waitFor(() => expect(screen.getByTestId("coin-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("coin-price").textContent).toBe("$80,000.00");
    expect(screen.getByTestId("coin-back").getAttribute("href")).toBe("/analytics/markets");
    for (const id of ["chart-pxoi", "chart-ls", "chart-funding", "chart-taker"]) await waitFor(() => expect(screen.getByTestId(id).dataset["state"]).toBe("ready"), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId("coin-liq").textContent).toContain("L $"));
    expect(screen.getByTestId("coin-cap").textContent).toContain("Dominance");
    expect(screen.getByTestId("liq-heatmap").dataset["count"]).toMatch(/^\d+$/);
    await waitFor(() => expect(screen.getByTestId("table-coin-markets").dataset["rows"]).toBe("3"));
    expect(screen.getByTestId("table-coin-funding").dataset["rows"]).toBe("3");
    expect(screen.getByTestId("table-coin-funding").textContent).toMatch(/\d+h \d+m|due/);
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("chart-pxoi")).getByText("1D"));
    expect(screen.getByTestId("chart-pxoi").dataset["state"]).toBe("ready");
    await u.click(within(screen.getByTestId("chart-liq")).getByText("7D"));
    await u.click(within(screen.getByTestId("chart-liq")).getByText("1D"));
    await u.click(within(screen.getByTestId("chart-funding")).getByText("90D"));
    const svg = within(screen.getByTestId("chart-pxoi")).getByRole("img");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 220, right: 720, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(svg, { clientX: 700, clientY: 100 });
    expect(within(screen.getByTestId("chart-pxoi")).getByTestId("chart-tip").textContent).toContain("Price");
    await u.click(screen.getByTestId("coin-compare"));
    expect(routerMock.push).toHaveBeenCalledWith("/analytics/markets?compare=BTC");
  });
  it("bits: HBars, LiqHeatmap and CoinSelect render their edge states", () => {
    renderWithProviders(
      <div>
        <HBars items={[{ label: "A", value: 2 }, { label: "B", value: 1, color: "red" }]} />
        <HBars items={[]} testId="none" />
        <LiqHeatmap rows={[{ band: 1, level: 101, cells: [0, 5] }, { band: -1, level: 99, cells: [0, 0] }]} hours={[0, 3600e3]} max={5} count={1} now={3600e3} />
        <CoinSelect value="ZZZ" symbols={["BTC"]} onChange={() => undefined} />
      </div>,
    );
    expect(screen.getByTestId("hbars").dataset["count"]).toBe("2");
    expect(screen.getByTestId("none").textContent).toContain("No venue");
    expect(screen.getByTestId("liq-heatmap").textContent).toContain("1 events");
    expect(screen.getByTestId<HTMLSelectElement>("coin-select").value).toBe("ZZZ");
  });
});

// Market Analytics pages and building blocks (HC-MA-003..037, 088..109) against the mock API's analytics snapshots.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock, routerMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { AnalyticsShell, SectionSoon } from "./AnalyticsShell";
import { Chart } from "./Chart";
import { CoinPage } from "./CoinPage";
import { type Column, DataTable } from "./DataTable";
import { HubPage, categories, mergeRows } from "./HubPage";
import { OverviewPage } from "./OverviewPage";
import { ComingSoon, Gauge, Heat, SourceLine, Treemap } from "./bits";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ watchlist: [] });
});
afterEach(() => mock.restore());

describe("HC-MA-012..029 Markets Hub", () => {
  it("renders the tiles, source line, the derivatives table with sort/search/columns/CSV/star, tabs and side panels", async () => {
    pathnameMock.value = "/analytics/hub";
    renderWithProviders(<HubPage />);
    await waitFor(() => expect(screen.getByTestId("hub-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-oi").textContent).toContain("$");
    expect(screen.getByTestId("tile-fg-gauge")).toBeTruthy();
    expect(screen.getByTestId("tile-ls").textContent).toContain("Long");
    expect(screen.getAllByTestId("source-line")[0]?.textContent).toContain("Binance");
    await waitFor(() => expect(screen.getByTestId("table-hub-derivatives").dataset["rows"]).toBe("10"));
    const u = userEvent.setup();
    await u.click(screen.getByTestId("th-price"));
    expect(screen.getByTestId("table-hub-derivatives").dataset["sort"]).toBe("price");
    await u.click(screen.getByTestId("th-price"));
    expect(screen.getByTestId("table-hub-derivatives").dataset["dir"]).toBe("asc");
    expect(screen.getAllByTestId("table-row")[0]?.dataset["key"]).toBe("DOGE");
    await u.type(screen.getByTestId("table-search"), "eth");
    expect(screen.getByTestId("table-hub-derivatives").dataset["rows"]).toBe("1");
    await u.clear(screen.getByTestId("table-search"));
    await u.click(screen.getByTestId("table-columns"));
    await u.click(screen.getByTestId("col-funding"));
    expect(screen.queryByTestId("th-funding")).toBeNull();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await u.click(screen.getByTestId("table-csv"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]?.[0])).toContain("Assets,Price");
    await u.click(screen.getAllByTestId("star")[0]!);
    expect(useUiStore.getState().watchlist).toHaveLength(1);
    expect(screen.getByTestId("watch-strip")).toBeTruthy();
    await u.click(screen.getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/analytics\/coin\//));
    // tabs
    await u.click(within(screen.getByTestId("hub-tabs")).getByText("Spot"));
    expect(screen.getByTestId("table-hub-spot")).toBeTruthy();
    await u.click(within(screen.getByTestId("hub-tabs")).getByText("Categories"));
    expect(screen.getByTestId("table-categories").dataset["rows"]).toBe(String(categories(mergeRows([], [])).length || 3));
    await u.click(within(screen.getByTestId("hub-tabs")).getByText("Stock"));
    expect(screen.getAllByTestId("coming-soon").length).toBeGreaterThan(0);
    await u.click(within(screen.getByTestId("hub-tabs")).getByText("Memes"));
    expect(screen.getByTestId("table-hub-memes").dataset["rows"]).toBe("1");
    await u.click(within(screen.getByTestId("hub-tabs")).getByText("L1L2"));
    expect(Number(screen.getByTestId("table-hub-l1l2").dataset["rows"])).toBeGreaterThan(5);
    // gainers / losers and heatmap
    expect(screen.getByTestId("gl-list").children.length).toBe(8);
    await u.click(within(screen.getByTestId("gl-tabs")).getByText("Top Losers"));
    expect(screen.getByTestId("gl-list")).toBeTruthy();
    expect(screen.getByTestId("treemap").dataset["count"]).toBe("10");
    expect(screen.getByTestId("hub-etf").textContent).toContain("Coming soon");
  });
  it("merges overview rows into market rows and groups categories", () => {
    const m = [{ rank: 1, symbol: "BTC", name: "Bitcoin", price: 1, change1h: null, change24h: 2, change7d: null, marketCap: 10, volume24h: 1, sparkline7d: [] }, { rank: 2, symbol: "DOGE", name: "Doge", price: 1, change1h: null, change24h: null, change7d: null, marketCap: 5, volume24h: 1, sparkline7d: [] }];
    const rows = mergeRows(m, [{ symbol: "BTC", oiUsd: 100, oiChange1h: 0.01, oiChange24h: 0.02, funding: 0.0001, lsRatio: 1.1, liq24hUsd: 7, venues: 3 }]);
    expect(rows[0]).toMatchObject({ oiUsd: 100, funding: 0.0001 });
    expect(rows[1]?.oiUsd).toBeUndefined();
    const cats = categories(rows);
    expect(cats.map((c) => c.key)).toEqual(["layer-1", "memes"]);
    expect(cats[0]).toMatchObject({ coins: 1, openInterest: 100, avgChange: 2, top: "BTC" });
    expect(cats[1]?.avgChange).toBeNull();
  });
  it("shows the unavailable notice when nothing has been ingested", async () => {
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      renderWithProviders(<HubPage />);
      await waitFor(() => expect(screen.getByTestId("hub-page").dataset["state"]).toBe("unavailable"), { timeout: 4000 });
      expect(screen.getByTestId("hub-unavailable")).toBeTruthy();
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-030..037 Futures overview", () => {
  it("renders tiles, both timeframe charts, the gauge with history, gainers/losers, heatmap and the footer", async () => {
    pathnameMock.value = "/analytics/overview";
    renderWithProviders(<OverviewPage />);
    await waitFor(() => expect(screen.getByTestId("overview-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-btc").textContent).toContain("$80,000.00");
    expect(screen.getByTestId("chart-oi").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("chart-ls").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("fg-gauge").dataset["value"]).toMatch(/^\d+$/);
    expect(screen.getByTestId("fg-history").textContent).toContain("Yesterday");
    expect(screen.getByTestId("chart-fg").dataset["state"]).toBe("ready"); // legend-less sparkline still plots
    expect(screen.getByTestId("table-gainers").dataset["rows"]).toBe("7");
    expect(screen.getByTestId("overview-footer").textContent).toContain("auto-refreshing every 60s");
    const u = userEvent.setup();
    const oiTf = within(screen.getByTestId("chart-oi")).getByTestId("chart-tf");
    await u.click(within(oiTf).getByText("1Y"));
    expect(screen.getByTestId("chart-oi").dataset["state"]).toBe("ready"); // 288 × 5 m points still plot within a year
    const legend = within(screen.getByTestId("chart-ls")).getAllByTestId("legend-item");
    await u.click(legend[0]!);
    expect(legend[0]!.dataset["on"]).toBe("false");
    await u.click(legend[1]!);
    expect(within(screen.getByTestId("chart-ls")).getByTestId("chart-empty").textContent).toContain("All series are hidden");
    await u.click(legend[0]!);
    const svg = within(screen.getByTestId("chart-oi")).getByRole("img");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 230, right: 720, bottom: 230, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(svg, { clientX: 360, clientY: 100 });
    expect(within(screen.getByTestId("chart-oi")).getByTestId("chart-tip").textContent).toContain("Open Interest");
    fireEvent.mouseLeave(svg);
    expect(within(screen.getByTestId("chart-oi")).queryByTestId("chart-tip")).toBeNull();
  });
});

describe("HC-MA-082 coin page and HC-MA-003..008 shell", () => {
  it("shows a coin's tiles, watches it, and reports an unknown symbol", async () => {
    renderWithProviders(<CoinPage symbol="btc" />);
    await waitFor(() => expect(screen.getByTestId("coin-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("coin-oi").textContent).toContain("$8.40B");
    await userEvent.setup().click(screen.getByTestId("coin-watch"));
    expect(useUiStore.getState().watchlist).toEqual(["BTC"]);
    renderWithProviders(<CoinPage symbol="ZZZ" />);
    await waitFor(() => expect(screen.getAllByTestId("coin-page").at(-1)?.dataset["state"]).toBe("unknown"), { timeout: 4000 });
    expect(screen.getByTestId("coin-unknown")).toBeTruthy();
  });
  it("shell: sections, terminal menu, palette button, coin search with keyboard, footer, and the soon page", async () => {
    pathnameMock.value = "/analytics/hub";
    renderWithProviders(
      <AnalyticsShell>
        <SectionSoon title="Whales" release="PR 5.4" blurb="soon" />
      </AnalyticsShell>,
    );
    const u = userEvent.setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Market Analytics");
    expect(screen.getByTestId("section-hub").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("analytics-back").getAttribute("href")).toBe("/analyse");
    await u.click(screen.getByTestId("section-terminal"));
    expect(screen.getByTestId("terminal-menu")).toBeTruthy();
    await u.click(screen.getByTestId("analytics-palette"));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(screen.getByTestId("section-soon").dataset["release"]).toBe("PR 5.4");
    expect(screen.getByTestId("analytics-footer").textContent).toContain("intervals vary per dataset");
    const search = screen.getByTestId("coin-search");
    await u.type(search, "e");
    await waitFor(() => expect(screen.getAllByTestId("coin-search-item").length).toBeGreaterThan(0), { timeout: 4000 });
    await u.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith("/analytics/coin/ETH");
    await u.type(search, "zzzz");
    expect(screen.getByTestId("coin-search-empty").textContent).toContain("No coin matches");
    await u.keyboard("{Escape}");
    expect(screen.queryByTestId("coin-search-list")).toBeNull();
    await u.click(search);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(screen.queryByTestId("coin-search-list")).toBeNull();
  });
});

describe("analytics bits", () => {
  it("DataTable sorts strings and nulls, shows the empty state, and skips the toolbar for small tables", async () => {
    type R = { id: string; name: string; v: number | null };
    const cols: Column<R>[] = [{ key: "name", label: "Name" }, { key: "v", label: "V", align: "r" }];
    const rows: R[] = [{ id: "a", name: "beta", v: null }, { id: "b", name: "alpha", v: 2 }, { id: "c", name: "gamma", v: 1 }];
    renderWithProviders(<DataTable id="t" rows={rows} cols={cols} rowKey={(r) => r.id} sortKey="v" />);
    expect(screen.getAllByTestId("table-row").map((r) => r.dataset["key"])).toEqual(["b", "c", "a"]); // nulls last
    expect(screen.queryByTestId("table-search")).toBeNull();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("th-name"));
    await u.click(screen.getByTestId("th-name"));
    expect(screen.getAllByTestId("table-row").map((r) => r.dataset["key"])).toEqual(["b", "a", "c"]); // alpha, beta, gamma
    renderWithProviders(<DataTable id="e" rows={[]} cols={cols} rowKey={(r) => r.id} empty="Nothing here" search />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
    await u.type(screen.getByTestId("table-search"), "x");
    expect(screen.getByText(/No rows match/)).toBeTruthy();
  });
  it("Heat, Gauge, Treemap, SourceLine and ComingSoon render their states", () => {
    renderWithProviders(
      <div>
        <Heat v={2} />
        <Heat v={null} />
        <Heat v={-0.01} fraction />
        <Gauge value={130} testId="g" />
        <Treemap items={[{ symbol: "A", marketCap: 70, change24h: 1 }, { symbol: "B", marketCap: 20, change24h: -1 }, { symbol: "C", marketCap: 10, change24h: null }]} h={100} />
        <Treemap items={[]} h={10} testId="empty" />
        <SourceLine snapshot={{ source: "OKX", asOf: Date.now() - 5000, stale: true }} />
        <SourceLine snapshot={undefined} />
        <ComingSoon title="X" why="because" />
        <Chart x={[]} series={[]} loading testId="c-loading" />
        <Chart x={["a"]} series={[{ label: "s", data: [] }]} legend={false} testId="c-empty" empty="none" />
      </div>,
    );
    const heats = screen.getAllByTestId("heat-cell");
    expect(heats[0]?.textContent).toBe("+2.00%");
    expect(heats[1]?.textContent).toBe("—");
    expect(heats[2]?.textContent).toBe("-1.00%");
    expect(screen.getByTestId("g").dataset["value"]).toBe("100");
    expect(screen.getByTestId("treemap").dataset["count"]).toBe("3");
    expect(screen.getByTestId("empty").dataset["count"]).toBe("0");
    expect(screen.getByTestId("source-line").dataset["stale"]).toBe("true");
    expect(screen.getByText("stale")).toBeTruthy();
    expect(screen.getByTestId("coming-soon").textContent).toContain("GAPS #55");
    expect(screen.getByTestId("c-loading").dataset["state"]).toBe("loading");
    expect(screen.getByTestId("chart-skeleton")).toBeTruthy();
    expect(screen.getByTestId("c-empty").dataset["state"]).toBe("empty");
    expect(screen.getByText("none")).toBeTruthy();
  });
});

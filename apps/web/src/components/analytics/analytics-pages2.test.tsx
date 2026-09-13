// Options, Sentiment and ETF pages (HC-MA-049..059, 073..081, 114, 115, 118, 119) against the mock API's snapshots,
// plus the Donut / Checklist / RsiCell bits.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock, routerMock, searchParamsMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { EtfPage } from "./EtfPage";
import { OptionsPage } from "./OptionsPage";
import { SentimentPage } from "./SentimentPage";
import { WhalesPage } from "./WhalesPage";
import { Checklist, Donut, RsiCell } from "./bits";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ watchlist: [] });
  searchParamsMock.value = new URLSearchParams();
});
afterEach(() => mock.restore());

describe("HC-MA-049..053, 114 Options", () => {
  it("renders tiles, the expiry chart with max-pain labels, the donut and the exchanges table; toggles switch venue and coin", async () => {
    pathnameMock.value = "/analytics/options";
    renderWithProviders(<OptionsPage />);
    await waitFor(() => expect(screen.getByTestId("options-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("options-page").dataset["exchange"]).toBe("deribit");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Deribit · Options");
    expect(screen.getByTestId("tile-oi").textContent).toContain("$");
    expect(screen.getByTestId("tile-maxpain").textContent).toContain("$");
    expect(screen.getByTestId("chart-expiry").dataset["state"]).toBe("ready");
    expect(within(screen.getByTestId("chart-expiry")).getAllByTestId("chart-label").length).toBe(8);
    expect(screen.getByTestId("donut").dataset["count"]).toBe("2");
    expect(screen.getByTestId("table-options-exchanges").dataset["rows"]).toBe("2");
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("options-exchange")).getByText("Delta India"));
    expect(screen.getByTestId("options-page").dataset["exchange"]).toBe("delta");
    expect(routerMock.replace).toHaveBeenCalledWith("/analytics/options?symbol=BTC&exchange=delta");
    await u.selectOptions(screen.getByTestId("options-symbol"), "ETH");
    expect(screen.getByTestId("options-page").dataset["symbol"]).toBe("ETH");
    await waitFor(() => expect(screen.getByTestId("tile-contracts").textContent).toContain("Put/Call"), { timeout: 4000 });
    expect(screen.getByTestId("options-footer").textContent).toContain("every 300s");
  });
  it("reads the query, and reports an unknown coin as unavailable", async () => {
    searchParamsMock.value = new URLSearchParams("symbol=eth&exchange=delta");
    renderWithProviders(<OptionsPage />);
    await waitFor(() => expect(screen.getByTestId("options-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("options-page").dataset["symbol"]).toBe("ETH");
    expect(screen.getByTestId("options-page").dataset["exchange"]).toBe("delta");
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      searchParamsMock.value = new URLSearchParams();
      renderWithProviders(<OptionsPage />);
      await waitFor(() => expect(screen.getAllByTestId("options-page").at(-1)?.dataset["state"]).toBe("unavailable"), { timeout: 4000 });
      expect(screen.getByTestId("options-unavailable").textContent).toContain("BTC");
      expect(screen.getAllByTestId("donut").at(-1)?.textContent).toContain("No venue has reported yet");
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-073..081, 118, 119 Sentiment", () => {
  it("renders the gauge with bands, the checklist, the three log charts with regions, the premium bars and the RSI screener", async () => {
    pathnameMock.value = "/analytics/sentiment";
    renderWithProviders(<SentimentPage />);
    await waitFor(() => expect(screen.getByTestId("sentiment-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("fg-gauge").dataset["value"]).toMatch(/^\d+$/);
    expect(within(screen.getByTestId("chart-fg")).getAllByTestId("chart-band").length).toBe(4);
    await waitFor(() => expect(screen.getByTestId("check-summary").textContent).toMatch(/\d \/ \d triggered/), { timeout: 4000 });
    const rows = screen.getAllByTestId("check-row");
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.dataset["hit"] === "na").length).toBeGreaterThanOrEqual(2); // AHR999 and Puell
    for (const id of ["chart-pi", "chart-rainbow", "chart-ma2", "chart-premium"]) await waitFor(() => expect(screen.getByTestId(id).dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(within(screen.getByTestId("chart-rainbow")).getAllByTestId("chart-region").length).toBe(9);
    expect(screen.getByTestId("rainbow-legend").textContent).toContain("Maximum bubble");
    expect(screen.queryByTestId("ma2-note")).toBeNull(); // the mock window holds 1000 closes, so the 2-year average exists
  });
  it("timeframes, RSI screener tools and the premium footer", async () => {
    renderWithProviders(<SentimentPage />);
    await waitFor(() => expect(screen.getByTestId("table-rsi").dataset["rows"]).toBe("10"), { timeout: 4000 });
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("cycle-tf")).getByText("30D"));
    expect(screen.getByTestId("chart-pi").dataset["state"]).toBe("ready");
    await u.click(within(screen.getByTestId("cycle-tf")).getByText("ALL"));
    await u.click(within(screen.getByTestId("chart-fg")).getByText("1Y"));
    await u.click(within(screen.getByTestId("chart-premium")).getByText("30D"));
    expect(screen.getByTestId("chart-premium").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("premium-now").textContent).toContain("hourly points kept");
    expect(screen.getAllByTestId("rsi-cell").length).toBeGreaterThan(50);
    await u.click(screen.getByTestId("th-rsi_1h"));
    expect(screen.getByTestId("table-rsi").dataset["sort"]).toBe("rsi_1h");
    await u.type(screen.getByTestId("table-search"), "sol");
    expect(screen.getByTestId("table-rsi").dataset["rows"]).toBe("1");
    expect(screen.getAllByTestId("table-row")[0]?.textContent).toContain("—"); // SOL 15m is null in the mock
    await u.clear(screen.getByTestId("table-search"));
    await u.click(screen.getAllByTestId("star")[0]!);
    expect(useUiStore.getState().watchlist).toHaveLength(1);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await u.click(screen.getByTestId("table-csv"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]?.[0])).toContain("RSI 15m");
    await u.click(screen.getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/analytics\/coin\/[A-Z]+$/));
  });
  it("shows the unavailable notice when nothing has been ingested", async () => {
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      renderWithProviders(<SentimentPage />);
      await waitFor(() => expect(screen.getByTestId("sentiment-page").dataset["state"]).toBe("unavailable"), { timeout: 10_000 }); // four 503s settle slowly under the forced gate
      expect(screen.getByTestId("sentiment-unavailable")).toBeTruthy();
      expect(screen.getByTestId("fg-label").textContent).toContain("waiting for alternative.me");
      expect(screen.getAllByTestId("check-row").every((r) => r.dataset["hit"] === "na")).toBe(true);
      // the premium chart's own request settles after the page's state flips: wait for its empty state rather than read it at once
      await waitFor(() => expect(within(screen.getByTestId("chart-premium")).getByTestId("chart-empty").textContent).toContain("COINGECKO_API_KEY"), { timeout: 10_000 });
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-067..072, 117 Whales", () => {
  it("renders tiles with the gauge, the alerts feed, the index chart, both tables and the reserves placeholder", async () => {
    pathnameMock.value = "/analytics/whales";
    renderWithProviders(<WhalesPage />);
    await waitFor(() => expect(screen.getByTestId("whales-page").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-longs").textContent).toContain("positions");
    expect(screen.getByTestId("tile-shorts").textContent).toContain("uPnL");
    expect(screen.getByTestId("tile-orders").textContent).toContain("7");
    expect(screen.getByTestId("whale-gauge").dataset["value"]).toMatch(/^\d+$/);
    expect(screen.getByTestId("whale-feed").dataset["rows"]).toBe("20");
    expect(screen.getAllByTestId("whale-row")[0]?.textContent).toContain("$");
    expect(screen.getByTestId("chart-index").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("index-note").textContent).toContain("6 with positions of 14 polled");
    expect(screen.getByTestId("table-whale-positions").dataset["rows"]).toBe("12");
    expect(screen.getByTestId("table-large-orders").dataset["rows"]).toBe("8");
    expect(within(screen.getByTestId("table-large-orders")).getAllByText("gone")).toHaveLength(1);
    expect(within(screen.getByTestId("panel-reserves")).getByTestId("coming-soon").textContent).toContain("GAPS #55");
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("chart-index")).getByText("7D"));
    expect(screen.getByTestId("chart-index").dataset["state"]).toBe("ready");
    await u.click(within(screen.getByTestId("chart-index")).getByText("1D"));
    const positions = screen.getByTestId("table-whale-positions");
    await u.click(within(positions).getByTestId("th-unrealizedPnl"));
    expect(positions.dataset["sort"]).toBe("unrealizedPnl");
    await u.type(within(positions).getByTestId("table-search"), "eth");
    expect(Number(positions.dataset["rows"])).toBeLessThan(12);
    await u.click(within(positions).getByTestId("table-columns"));
    await u.click(within(positions).getByTestId("col-marginUsed"));
    expect(within(positions).getByTestId("th-marginUsed")).toBeTruthy();
    await u.click(within(positions).getAllByTestId("table-row")[0]!);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringMatching(/^\/analytics\/coin\//));
    await u.click(within(screen.getByTestId("table-large-orders")).getByTestId("th-resting"));
    expect(screen.getByTestId("table-large-orders").dataset["sort"]).toBe("resting");
  });
  it("shows the unavailable notice and the empty feed", async () => {
    mock.restore();
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "not yet" }), { status: 503, headers: { "content-type": "application/json" } })));
    try {
      renderWithProviders(<WhalesPage />);
      await waitFor(() => expect(screen.getByTestId("whales-page").dataset["state"]).toBe("unavailable"), { timeout: 4000 });
      expect(screen.getByTestId("whales-unavailable")).toBeTruthy();
      expect(screen.getByTestId("whale-feed-empty").textContent).toContain("No alerts yet");
      expect(screen.getByTestId("tile-index").textContent).toContain("Quiet");
    } finally {
      globalThis.fetch = original;
      mock = installMockFetch();
    }
  });
});

describe("HC-MA-054..059, 115 ETF and bits", () => {
  it("ETF keeps the layout with coming-soon panels and an asset toggle", async () => {
    renderWithProviders(<EtfPage />);
    expect(screen.getByTestId("etf-page").dataset["asset"]).toBe("bitcoin");
    expect(screen.getAllByTestId("coming-soon").length).toBe(4);
    await userEvent.setup().click(within(screen.getByTestId("etf-asset")).getByText("Ethereum"));
    expect(screen.getByTestId("etf-page").dataset["asset"]).toBe("ethereum");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Ethereum");
  });
  it("Donut, Checklist and RsiCell edge states", () => {
    renderWithProviders(
      <div>
        <Donut items={[{ label: "A", value: 3, color: "red" }, { label: "B", value: 1, color: "blue" }]} center="$4" testId="d1" />
        <Donut items={[{ label: "Z", value: 0, color: "red" }]} testId="d0" />
        <Checklist rows={[{ name: "x", sub: "s", value: "1", hit: true }, { name: "y", sub: "s", value: "2", hit: false }, { name: "z", sub: "s", value: "3", hit: null }]} testId="cl" />
        <RsiCell v={80} />
        <RsiCell v={20} />
        <RsiCell v={50} />
        <RsiCell v={null} />
      </div>,
    );
    expect(screen.getByTestId("d1").textContent).toContain("75.0%");
    expect(screen.getByTestId("d0").textContent).toContain("—");
    expect(screen.getByTestId("cl").dataset["hits"]).toBe("1");
    expect(screen.getAllByTestId("rsi-cell").map((c) => c.dataset["zone"])).toEqual(["overbought", "oversold", "neutral"]);
  });
});

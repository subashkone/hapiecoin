// Scenarios, Vol and Structure tabs (HC-WS-088..100) against the inline pricing engine, the fake gateway and the
// recorded instrument list: the price × date matrix with its modes, range, IV shift, target and smooth field;
// the smile, skew, term structure and expiry switch; open interest with max pain, the ratios and GEX.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { AnalysisPane } from "./AnalysisPane";

const EXPIRY = "2026-09-25";
const LATER = "2026-10-30";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;

function seedStraddle() {
  const s = useUiStore.getState();
  const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
  const row = rows[atm]!;
  s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: row.strike, expiry: EXPIRY, lots: 10, price: row.call!.mark, iv: row.call!.markIv });
  s.addLeg({ asset: "BTC", kind: "put", side: "buy", strike: row.strike, expiry: EXPIRY, lots: 10, price: row.put!.mark, iv: row.put!.markIv });
  return row;
}
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs("tabs@example.com");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({ asset: "BTC", expiry: { BTC: EXPIRY }, legs: { BTC: [], ETH: [], XAUT: [] }, analysisTab: "payoff", targetPrice: null, targetDays: 0, paneSource: null, adjust: null });
});
afterEach(() => mock.restore());

describe("HC-WS-088..093 Scenarios", () => {
  it("shows the designed empty state with the controls, then the matrix once legs and the spot arrive", async () => {
    renderWithProviders(<AnalysisPane />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("analysis-tab-scenarios"));
    expect(screen.getByTestId("scenarios-panel").dataset["state"]).toBe("empty");
    expect(screen.getByTestId("scenario-controls")).toBeTruthy();
    expect(screen.getByText("No strategy yet")).toBeTruthy();
  });

  it("prices the straddle over 11 prices × dates, shades by sign, outlines the target and sets it on click; modes, range, IV shift and smooth", async () => {
    seedStraddle();
    renderWithProviders(<AnalysisPane />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("analysis-tab-scenarios"));
    const panel = screen.getByTestId("scenarios-panel");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"), { timeout: 5000 });
    const matrix = screen.getByTestId("scenario-matrix");
    expect(matrix.dataset["rows"]).toBe("11");
    expect(Number(matrix.dataset["cols"])).toBeGreaterThanOrEqual(2);
    const cells = screen.getAllByTestId("scenario-cell");
    expect(cells.length).toBe(11 * Number(matrix.dataset["cols"]));
    // a long straddle loses at spot today and profits far from it at expiry
    const spotRowLabel = screen.getAllByTestId("scenario-row-label").findIndex((l) => l.textContent?.includes("SPOT"));
    expect(spotRowLabel).toBe(5);
    const lastCol = Number(matrix.dataset["cols"]) - 1;
    const cellAt = (i: number, j: number) => cells.find((c) => c.dataset["i"] === String(i) && c.dataset["j"] === String(j))!;
    expect(cellAt(5, lastCol).dataset["tone"]).toBe("loss");
    expect(cellAt(0, lastCol).dataset["tone"]).toBe("profit");
    expect(cellAt(10, lastCol).dataset["tone"]).toBe("profit");
    // the target defaults to spot / today and is outlined there
    expect(cellAt(5, 0).dataset["target"]).toBe("true");
    expect(screen.getAllByTestId("scenario-col")[0]!.textContent).toContain("Today");
    // clicking a cell moves the target sliders
    await u.click(cellAt(0, lastCol));
    expect(useUiStore.getState().targetPrice).toBeCloseTo(79521 * 1.1, 0);
    expect(useUiStore.getState().targetDays).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByTestId("scenario-cell").find((c) => c.dataset["i"] === "0" && c.dataset["j"] === String(lastCol))!.dataset["target"]).toBe("true"));
    // hover readout
    fireEvent.mouseEnter(cellAt(2, 1));
    expect(screen.getByTestId("scenario-readout").textContent).toMatch(/\(\+6%\)/);
    // delta mode changes the unit; the ±20 % range widens the rows; the IV shift re-prices
    await u.click(screen.getByTestId("scenario-mode-delta"));
    expect(screen.getByTestId("scenario-unit").textContent).toBe("BTC Δ");
    await waitFor(() => expect(screen.getByTestId("scenarios-panel").dataset["mode"]).toBe("delta"));
    await u.click(screen.getByTestId("scenario-mode-theta"));
    expect(screen.getByTestId("scenario-unit").textContent).toBe("USD / day");
    await u.click(screen.getByTestId("scenario-mode-pnl"));
    await u.click(screen.getByTestId("scenario-range-20"));
    await waitFor(() => expect(screen.getAllByTestId("scenario-row-label")[0]!.textContent).toContain("95,425"));
    // more IV makes a long straddle worth more on the target-date columns: the spot cell today loses less
    const spotToday = () => screen.getAllByTestId("scenario-cell").find((c) => c.dataset["i"] === "5" && c.dataset["j"] === "0")!.textContent;
    const before = spotToday();
    fireEvent.change(screen.getByTestId("scenario-iv"), { target: { value: "15" } });
    expect(screen.getByTestId("scenario-iv-value").textContent).toBe("+15%");
    await waitFor(() => expect(screen.getByTestId("scenarios-panel").dataset["pending"]).toBeUndefined(), { timeout: 5000 });
    await waitFor(() => expect(spotToday()).not.toBe(before), { timeout: 5000 });
    const money = (t: string) => Number(t.replace(/[^0-9.-]/g, "")) * (t.includes("−") || t.includes("-") ? -1 : 1);
    expect(money(spotToday())).toBeGreaterThan(money(before));
    // smooth: the canvas field replaces the cells
    await u.click(screen.getByTestId("scenario-smooth"));
    expect(screen.getByTestId("scenario-heat").dataset["rows"]).toBe("11");
    expect(screen.queryAllByTestId("scenario-cell")).toHaveLength(0);
    await u.click(screen.getByTestId("scenario-smooth"));
    expect(screen.getAllByTestId("scenario-cell").length).toBeGreaterThan(0);
  });
});

describe("HC-WS-094..097 Vol", () => {
  it("draws the smile of the shown expiry with the strategy strikes, the 25Δ skew, the term structure with an expiry switch, and honest placeholders for IV history", async () => {
    seedStraddle();
    renderWithProviders(<AnalysisPane />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("analysis-tab-vol"));
    serveMarket(); // the tab subscribes to the chain when it mounts; the gateway answers with a snapshot
    const panel = screen.getByTestId("vol-panel");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"), { timeout: 5000 });
    expect(panel.dataset["expiry"]).toBe(EXPIRY);
    expect(within(panel).getByTestId("chart-smile").dataset["state"]).toBe("ready");
    expect(within(panel).getByTestId("skew-25").textContent).toMatch(/pts/);
    expect(within(panel).getByTestId("smile-readout").textContent).toMatch(/ATM IV \d+\.\d%/);
    expect(within(panel).getByTestId("smile-readout").textContent).toContain("Expected move ±");
    // five listed expiries; only the shown one has a chain served, so it carries the IV and the others wait
    const chips = within(panel).getAllByTestId("term-expiry");
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.find((c) => c.dataset["expiry"] === EXPIRY)!.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).queryByTestId("vol-legs-hint")).toBeNull();
    // a chip switches the shown expiry (the workspace's); the hint offers the strategy's expiry back
    await u.click(chips.find((c) => c.dataset["expiry"] === LATER)!);
    expect(useUiStore.getState().expiry["BTC"]).toBe(LATER);
    expect(panel.dataset["expiry"]).toBe(LATER);
    expect(panel.dataset["state"]).toBe("pending"); // no chain served for it yet
    await u.click(within(panel).getByTestId("vol-show-legs-expiry"));
    expect(panel.dataset["expiry"]).toBe(EXPIRY);
    expect(within(panel).queryByTestId("vol-legs-hint")).toBeNull();
    // HC-WS-096 / 097 (ADR-056): IV rank on the year's range with the interpretation line; realised vs implied with the spread
    await waitFor(() => expect(within(panel).getByTestId("iv-rank")).toBeTruthy(), { timeout: 5000 });
    const rank = within(panel).getByTestId("iv-rank");
    expect(Number(rank.dataset["rank"])).toBeGreaterThanOrEqual(0);
    expect(Number(rank.dataset["rank"])).toBeLessThanOrEqual(100);
    expect(rank.dataset["days"]).toBe("365");
    expect(within(panel).getByTestId("iv-rank-value").textContent).toMatch(/^\d+$/);
    expect(within(panel).getByTestId("iv-rank-label").textContent).toMatch(/premium/);
    expect(within(panel).getByTestId("rv-iv").dataset["days"]).toBe("30");
    expect(within(panel).getByTestId("chart-rv-iv").dataset["state"]).toBe("ready");
    expect(within(panel).getByTestId("rv-iv-spread").textContent).toMatch(/[+-]\d+\.\d pts/);
    expect(within(panel).queryByTestId("coming-soon")).toBeNull();
  });

  it("HC-WS-096 / 097 read honestly while the API has no history yet (503)", async () => {
    mock.state.ivHistoryDays = 0;
    renderWithProviders(<AnalysisPane />);
    await userEvent.setup().click(screen.getByTestId("analysis-tab-vol"));
    await waitFor(() => expect(screen.getByTestId("iv-rank-waiting").dataset["state"]).toBe("none"), { timeout: 5000 });
    expect(screen.getByTestId("rv-iv-waiting").textContent).toContain("No history yet");
  });

  it("a chain with rows but no mark IV is an empty smile, not a wait", async () => {
    renderWithProviders(<AnalysisPane />);
    await userEvent.setup().click(screen.getByTestId("analysis-tab-vol"));
    act(() => {
      const ws = FakeSocket.last();
      ws.open();
      ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
      ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows: rows.map((r) => ({ strike: r.strike, call: r.call ? { ...r.call, markIv: undefined, greeks: undefined } : undefined, put: r.put ? { ...r.put, markIv: undefined, greeks: undefined } : undefined })) });
    });
    const panel = screen.getByTestId("vol-panel");
    await waitFor(() => expect(panel.dataset["state"]).toBe("empty"), { timeout: 5000 });
    expect(within(within(panel).getByTestId("chart-smile")).getByTestId("chart-empty").textContent).toContain("No mark IV");
    expect(within(panel).getByTestId("skew-25").textContent).toBe("—");
  });

  it("without legs it follows the workspace expiry", async () => {
    useUiStore.setState({ expiry: { BTC: LATER } });
    renderWithProviders(<AnalysisPane />);
    await userEvent.setup().click(screen.getByTestId("analysis-tab-vol"));
    act(() => {
      const ws = FakeSocket.last();
      ws.open();
      ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
      ws.receive({ t: "snap", topic: chainTopic("delta_india", "BTC", LATER), seq: 0, rows: buildChain("BTC", LATER) });
    });
    const panel = screen.getByTestId("vol-panel");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"), { timeout: 5000 });
    expect(panel.dataset["expiry"]).toBe(LATER);
    expect(within(panel).getByTestId("term-shape").textContent).toBe(""); // one chain served: no shape yet
  });
});

describe("HC-WS-098..100 Structure", () => {
  it("shows open interest with the max-pain marker, the put / call ratios and the dealer gamma profile from the live chain", async () => {
    seedStraddle();
    renderWithProviders(<AnalysisPane />);
    await userEvent.setup().click(screen.getByTestId("analysis-tab-structure"));
    serveMarket();
    const panel = screen.getByTestId("structure-panel");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"), { timeout: 5000 });
    expect(panel.dataset["expiry"]).toBe(EXPIRY);
    const mp = Number(panel.dataset["maxPain"]);
    expect(rows.some((r) => Number(r.strike) === mp)).toBe(true);
    expect(within(panel).getByTestId("max-pain-readout").textContent).toContain("Max pain");
    expect(within(panel).getByTestId("max-pain-readout").textContent).toContain("your strikes");
    expect(within(panel).getByTestId("chart-oi").dataset["state"]).toBe("ready");
    const pcr = within(panel).getByTestId("pcr-oi");
    expect(["put-heavy", "call-heavy", "balanced"]).toContain(pcr.dataset["read"]);
    expect(within(panel).getByTestId("pcr-volume").dataset["read"]).toBe("—"); // the fixture quotes carry no 24h volume
    expect(within(panel).getByTestId("chart-gex").dataset["state"]).toBe("ready");
    expect(within(panel).getByTestId("gex-readout").textContent).toMatch(/net GEX .*gamma/);
    expect(within(panel).getByTestId("gex-readout").textContent).toMatch(/dealers (dampen|amplify) moves/);
  });

  it("waits for the chain and the spot without legs or a snapshot", async () => {
    renderWithProviders(<AnalysisPane />);
    act(() => FakeSocket.last().open());
    await userEvent.setup().click(screen.getByTestId("analysis-tab-structure"));
    const panel = screen.getByTestId("structure-panel");
    expect(panel.dataset["state"]).toBe("pending");
    expect(within(panel).getAllByTestId("chart-empty").length).toBeGreaterThanOrEqual(2);
    expect(within(panel).getByTestId("max-pain-readout").textContent).toContain("—");
  });
});

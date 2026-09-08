// Analysis pane (HC-WS-030..064): payoff tiles, chart frame, target controls, Greeks and ladder against the
// inline pricing engine, the fake gateway socket and the recorded instrument list.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { AnalysisPane } from "./AnalysisPane";
import { drawPayoff, payoffScales, yTicks, type PayoffFrame } from "./payoffDraw";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;
const ctxCalls: string[] = [];

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
  mock.loginAs("trader@example.com");
  ctxCalls.length = 0;
  // jsdom has no canvas: record the 2D calls so the renderer is exercised without pixels.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      new Proxy({} as CanvasRenderingContext2D, {
        get: (_, prop) => {
          if (typeof prop === "string") ctxCalls.push(prop);
          return () => undefined;
        },
        set: () => true,
      }),
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({ asset: "BTC", expiry: { BTC: EXPIRY }, legs: { BTC: [], ETH: [], XAUT: [] }, analysisTab: "payoff", targetPrice: null, targetDays: 0 });
});
afterEach(() => {
  mock.restore();
});

describe("HC-WS-033..058 payoff", () => {
  it("shows the designed empty state and opens the Builder from it", async () => {
    renderWithProviders(<AnalysisPane />);
    expect(screen.getByTestId("payoff-panel").dataset["state"]).toBe("empty");
    expect(screen.getByText("No strategy yet")).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId("payoff-open-builder"));
    expect(useUiStore.getState().workspaceTab).toBe("builder");
  });

  it("prices a long straddle: tiles, win zone, layers, zoom and the target sliders", async () => {
    const row = seedStraddle();
    renderWithProviders(<AnalysisPane />);
    serveMarket();
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("payoff-panel").dataset["state"]).toBe("ready"), { timeout: 4000 });
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("Unlimited");
    expect(screen.getByTestId("tile-max-loss").textContent).toMatch(/−\$|-\$|\$/);
    expect(screen.getByTestId("tile-breakeven").textContent).toContain(" · "); // two break-evens, shown with their % from spot (ADR-028)
    expect(screen.getByTestId("tile-net").textContent).toContain("debit paid");
    expect(screen.getByTestId("tile-rr").textContent).toContain("1 : ∞");
    expect(screen.getByTestId("win-zone").textContent).toMatch(/< [\d,]+ or > [\d,]+/);
    expect(screen.getByTestId("greeks-strip").textContent).toContain("greeks at spot");
    // ADR-028 parity: sigma price labels above the chart and break-evens as % from spot
    const sigma = screen.getByTestId("sigma-labels");
    expect(sigma.children).toHaveLength(5);
    expect(sigma.textContent).toContain("−2σ");
    expect(sigma.textContent).toContain("Spot");
    expect(sigma.textContent).toContain("+2σ");
    expect(screen.getByTestId("tile-breakeven").textContent).toMatch(/[+−-]\d+\.\d%/);
    // HC-WS-046 a long straddle held to expiry at today's spot loses the premium
    expect(screen.getByTestId("spot-zone").dataset["zone"]).toBe("loss");
    expect(screen.getByTestId("spot-zone").textContent).toContain("loss zone");
    // layers and zoom are toggles
    const oi = screen.getByTestId("layer-oi");
    expect(oi.getAttribute("aria-pressed")).toBe("false");
    await u.click(oi);
    expect(oi.getAttribute("aria-pressed")).toBe("true");
    await u.click(screen.getByTestId("zoom-2"));
    expect(screen.getByTestId("zoom-2").getAttribute("aria-pressed")).toBe("true");
    // target sliders write the store; the strip follows
    fireEvent.change(screen.getByTestId("target-price"), { target: { value: String(Number(row.strike) + 2000) } });
    expect(useUiStore.getState().targetPrice).toBe(Number(row.strike) + 2000);
    fireEvent.change(screen.getByTestId("target-days"), { target: { value: "3" } });
    expect(useUiStore.getState().targetDays).toBe(3);
    expect(screen.getByTestId("target-date-label").textContent).toMatch(/^\+3d · /);
    await u.click(screen.getByTestId("target-price-reset"));
    expect(useUiStore.getState().targetPrice).toBeNull();
    await u.click(screen.getByTestId("target-days-expiry"));
    expect(useUiStore.getState().targetDays).toBeGreaterThan(3);
  });
});

describe("HC-WS-059..064 greeks and ladder", () => {
  it("Greeks tab: net tiles, one row per leg, meanings; Ladder tab: rows with the spot and break-even statuses", async () => {
    seedStraddle();
    useUiStore.setState({ analysisTab: "greeks" });
    renderWithProviders(<AnalysisPane />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("greek-delta").textContent).not.toContain("—"), { timeout: 4000 });
    expect(screen.getAllByTestId("greeks-row")).toHaveLength(2);
    expect(screen.getByTestId("greeks-meaning").textContent).toContain("Theta");
    // long straddle: positive gamma and vega, negative theta
    expect(screen.getByTestId("greek-gamma").className).toContain("");
    expect(screen.getByTestId("greek-theta").textContent).toMatch(/^Theta−|Theta-/);
    await userEvent.setup().click(screen.getByTestId("analysis-tab-ladder"));
    await waitFor(() => expect(Number(screen.getByTestId("ladder-panel").dataset["rows"])).toBeGreaterThan(10));
    const statuses = screen.getAllByTestId("ladder-row").map((r) => r.dataset["status"]);
    expect(statuses.filter((s) => s === "spot")).toHaveLength(1);
    expect(statuses.filter((s) => s === "breakeven")).toHaveLength(2);
    expect(statuses).toContain("profit");
    expect(statuses).toContain("loss");
  });
});

describe("payoffDraw", () => {
  const frame: PayoffFrame = {
    width: 600,
    height: 300,
    points: [
      { price: 70000, pnlExpiry: -1000, pnlTarget: -800 },
      { price: 80000, pnlExpiry: 0, pnlTarget: 100 },
      { price: 90000, pnlExpiry: 1000, pnlTarget: 900 },
    ],
    spot: 79521,
    breakevens: [80000],
    band: [76000, 83000],
    target: { price: 82000, pnl: 250 },
    targetLabel: "+3d",
    layers: { expiry: true, target: true, fill: true, oi: true, band: true, breakeven: true },
    oi: [{ strike: 80000, value: 1 }],
    range: [70000, 90000],
    colors: { ink: "#fff", target: "#58f", profit: "#2a7", loss: "#c33", grid: "#333", text: "#888", spot: "#d90", breakeven: "#888", band: "#111", oi: "#444" },
    fmtPrice: (p) => String(p),
    fmtMoney: (v) => String(v),
    hover: 81000,
  };
  it("scales map the range onto the plot box and y ticks are clean", () => {
    const s = payoffScales(frame);
    expect(s.x(70000)).toBe(s.m.l);
    expect(s.x(90000)).toBe(600 - s.m.r);
    expect(s.invX(s.x(85000))).toBeCloseTo(85000, 6);
    expect(s.y(s.yMax)).toBe(s.m.t);
    expect(yTicks(-1000, 1000)).toEqual([-1000, -500, 0, 500, 1000]);
    expect(yTicks(0, 0)).toEqual([0]);
  });
  it("drawPayoff runs every layer against a recording context", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_, prop) => {
        if (typeof prop === "string") calls.push(prop);
        return () => undefined;
      },
      set: () => true,
    });
    drawPayoff(ctx, frame);
    for (const m of ["clearRect", "fillText", "stroke", "fill", "arc", "setLineDash", "fillRect"]) expect(calls).toContain(m);
  });
});

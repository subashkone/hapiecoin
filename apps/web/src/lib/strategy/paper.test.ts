import type { Broker, Strategy, StrategyLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { dayPnl, daysOf, feeFor, legPnl, localLegToInput, pickToInput, pnlSeries, priceMap, serverLegToLocal, strategyPnl } from "./paper";

const BROKER: Broker = { id: "brk", name: "Delta Exchange India", feePct: "0.05", gstPct: "18", feeCapPct: "10", scope: "GLOBAL" };
const leg = (over: Partial<StrategyLeg> = {}): StrategyLeg => ({
  id: "leg_1",
  kind: "call",
  side: "buy",
  strike: "80000",
  expiry: "2026-09-25",
  symbol: "C-BTC-80000-250926",
  lots: 10,
  price: "1200",
  entryPrice: "1200",
  exitPrice: null,
  iv: 0.5,
  status: "open",
  isAdjustment: false,
  position: 0,
  openedAt: "2026-09-08T10:00:00Z",
  closedAt: null,
  orderId: null,
  ...over,
});
const strat = (over: Partial<Strategy> = {}): Strategy => ({
  id: "strat_1",
  name: "Test",
  asset: "BTC",
  status: "paper",
  tradingMode: "paper",
  templateName: "Custom",
  brokerId: "brk",
  legs: [leg()],
  realizedPnl: "0",
  pnlHistory: [],
  notes: "",
  tags: [],
  orderBatchId: null,
  orders: [],
  adjustments: [],
  startedAt: "2026-09-01T10:00:00Z",
  closedAt: null,
  createdAt: "2026-09-01T09:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  ...over,
});

describe("HC-TR-019 / HC-TR-052 fee estimate", () => {
  it("charges fee % of notional, caps options at cap % of premium, adds GST, and never caps futures", () => {
    // option: notional 80,000 × 0.01 = 800 → 0.05 % = 0.40; cap = 1200 × 0.01 × 10 % = 1.20 → fee 0.40, GST 18 % = 0.072
    const f = feeFor([{ id: "a", kind: "call", lots: 10, price: "1200" }], 80_000, "0.001", BROKER);
    expect(f.fee).toBeCloseTo(0.4, 6);
    expect(f.gst).toBeCloseTo(0.072, 6);
    expect(f.total).toBeCloseTo(0.472, 6);
    // cheap option: premium 10 × 0.01 = 0.10 → cap 0.01 beats the 0.40 notional fee
    expect(feeFor([{ id: "b", kind: "put", lots: 10, price: "10" }], 80_000, "0.001", BROKER).fee).toBeCloseTo(0.01, 6);
    // future: no cap
    expect(feeFor([{ id: "c", kind: "future", lots: 10, price: "10" }], 80_000, "0.001", BROKER).fee).toBeCloseTo(0.4, 6);
    expect(feeFor([{ id: "a", kind: "call", lots: 10, price: "1200" }], 80_000, "0.001", undefined).total).toBe(0);
  });
});

describe("HC-TR-061 / HC-TR-073 P&L", () => {
  it("prices open legs at the current mark and closed legs at their exit, with the side sign", () => {
    expect(legPnl(leg(), 1300, "0.001").pnl).toBeCloseTo(1, 9); // (1300−1200) × 10 × 0.001
    expect(legPnl(leg({ side: "sell" }), 1300, "0.001").pnl).toBeCloseTo(-1, 9);
    expect(legPnl(leg({ status: "squared_off", exitPrice: "1100" }), 9999, "0.001").pnl).toBeCloseTo(-1, 9);
    expect(legPnl(leg(), null, "0.001").pnl).toBe(0); // no quote yet → flat at entry
    const s = strat({ legs: [leg(), leg({ id: "leg_2", status: "squared_off", exitPrice: "1100" })], realizedPnl: "-1" });
    const p = strategyPnl(s, () => 1300, "0.001");
    expect(p.unrealized).toBeCloseTo(1, 9);
    expect(p.realized).toBe(-1);
    expect(p.total).toBeCloseTo(0, 9);
    expect(p.openLegs).toBe(1);
    expect(p.byLeg.get("leg_2")?.closed).toBe(true);
  });
  it("day P&L, days, sparkline series", () => {
    const s = strat({ pnlHistory: [{ day: "2026-09-06", pnl: "5" }, { day: "2026-09-07", pnl: "8" }] });
    expect(dayPnl(s, 10, "2026-09-08")).toBe(2);
    expect(dayPnl(strat(), 10, "2026-09-08")).toBe(10);
    expect(daysOf(s, Date.UTC(2026, 8, 8, 12))).toBe(7);
    expect(daysOf(strat({ startedAt: null }))).toBe(0);
    expect(daysOf(strat({ closedAt: "2026-09-03T10:00:00Z" }))).toBe(2);
    expect(pnlSeries(s, 10)).toEqual([5, 8, 10]);
    expect(pnlSeries(strat(), 3)).toEqual([0, 3]);
  });
});

describe("leg converters", () => {
  it("round-trips server legs through the Builder shape and builds API inputs from chain picks", () => {
    const local = serverLegToLocal(leg({ entryPrice: "1250" }), "BTC");
    expect(local).toMatchObject({ id: "leg_1", asset: "BTC", kind: "call", price: "1250", iv: 0.5, status: "open" });
    expect(localLegToInput({ ...local, kind: "future", expiry: "PERP", strike: "", symbol: "BTCUSD" })).toMatchObject({ kind: "future", strike: "", expiry: "PERP", symbol: "BTCUSD" });
    expect(localLegToInput(local)).toMatchObject({ kind: "call", strike: "80000", expiry: "2026-09-25", iv: 0.5 });
    expect(pickToInput({ asset: "BTC", kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", lots: 3, price: "900.123456" })).toEqual({ kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 3, price: "900.1235" });
    expect(priceMap([leg(), leg({ id: "leg_2" })], (l) => (l.id === "leg_1" ? 1300.55555 : null))).toEqual({ leg_1: "1300.5556", leg_2: "1200" });
  });
});

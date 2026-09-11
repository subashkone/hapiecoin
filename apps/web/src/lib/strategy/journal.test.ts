import type { Strategy, StrategyLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { closedLegs, closedTrades, equityCurve, filterTrades, journalCsv, journalStats, reasonLabel } from "./journal";

const leg = (o: Partial<StrategyLeg> = {}): StrategyLeg => ({ id: "leg_1", kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1000", entryPrice: "1000", exitPrice: null, iv: null, status: "open", isAdjustment: false, position: 0, openedAt: "2026-09-01T00:00:00Z", closedAt: null, orderId: null, ...o });
const strat = (o: Partial<Strategy> = {}): Strategy => ({ id: "s1", name: "BTC Iron Butterfly", asset: "BTC", status: "archived", tradingMode: "paper", templateName: "Iron Butterfly", brokerId: null, legs: [leg()], realizedPnl: "1.44", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: "2026-07-30T00:00:00Z", closedAt: "2026-08-28T00:00:00Z", createdAt: "2026-07-30T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z", ...o });

const win = strat({ closeReason: "expired" });
const loss = strat({ id: "s2", name: "ETH Short Straddle", asset: "ETH", tradingMode: "live", templateName: "Short Straddle", realizedPnl: "-1.32", startedAt: "2026-07-10T00:00:00Z", closedAt: "2026-07-24T00:00:00Z", tags: ["earnings", "hedge"], notes: "got run over, \"call\" side" });
const flat = strat({ id: "s3", name: "XAUT flat", asset: "XAUT", templateName: "Custom", realizedPnl: "0", closedAt: "2026-08-01T00:00:00Z" });
const archivedDraft = strat({ id: "s4", name: "never traded", startedAt: null, closedAt: "2026-08-02T00:00:00Z", tradingMode: null });
const active = strat({ id: "s5", name: "active", status: "paper", closedAt: null, legs: [leg({ id: "a" }), leg({ id: "b", side: "sell", exitPrice: "980", price: "1255.9", entryPrice: "1255.9", status: "squared_off", closedAt: "2026-08-20T00:00:00Z", lots: 1 })] });

describe("HC-TR-128, 137 closed trades and legs", () => {
  it("lists traded archived strategies newest close first and skips archived drafts and active strategies", () => {
    const t = closedTrades([loss, win, flat, archivedDraft, active]);
    expect(t.map((x) => x.s.id)).toEqual(["s1", "s3", "s2"]);
    expect(t[0]).toMatchObject({ pnl: 1.44, mode: "paper", days: 29 });
    expect(t[2]!.mode).toBe("live");
  });
  it("closedLegs takes the squared-off legs of active strategies with their realised P&L", () => {
    const rows = closedLegs([win, active], () => "0.001");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leg.id).toBe("b");
    expect(rows[0]!.pnl).toBeCloseTo((1255.9 - 980) * 1 * 0.001, 9); // sold at 1255.9, bought back at 980
  });
});

describe("HC-TR-129 stats", () => {
  it("counts wins and losses, rates, extremes and the profit factor", () => {
    const st = journalStats(closedTrades([win, loss, flat]));
    expect(st).toMatchObject({ trades: 3, wins: 1, losses: 1, best: 1.44, worst: -1.32 });
    expect(st.winRate).toBeCloseTo(1 / 3);
    expect(st.avg).toBeCloseTo(0.12 / 3);
    expect(st.profitFactor).toBeCloseTo(1.44 / 1.32);
    expect(journalStats(closedTrades([win])).profitFactor).toBe(Number.POSITIVE_INFINITY);
    expect(journalStats(closedTrades([flat])).profitFactor).toBe(0);
    expect(journalStats([])).toMatchObject({ trades: 0, winRate: null, avg: null, best: null, worst: null, profitFactor: null });
  });
});

describe("HC-TR-130 equity curve", () => {
  it("starts at zero on the first open and accumulates over the close dates", () => {
    const pts = equityCurve(closedTrades([win, loss]));
    expect(pts.map((p) => p.v)[0]).toBe(0);
    expect(pts[1]!.v).toBeCloseTo(-1.32);
    expect(pts[2]!.v).toBeCloseTo(0.12);
    expect(pts[0]!.t).toBe(new Date("2026-07-10T00:00:00Z").getTime());
    expect(pts[1]!.trade!.s.id).toBe("s2");
    expect(pts[2]!.trade!.s.id).toBe("s1");
    expect(equityCurve([])).toEqual([]);
  });
});

describe("HC-TR-131, 134 filters, search and CSV", () => {
  const trades = closedTrades([win, loss, flat]);
  it("chips and search", () => {
    expect(filterTrades(trades, "all", "").map((t) => t.s.id)).toEqual(["s1", "s3", "s2"]);
    expect(filterTrades(trades, "paper", "").map((t) => t.s.id)).toEqual(["s1", "s3"]);
    expect(filterTrades(trades, "live", "").map((t) => t.s.id)).toEqual(["s2"]);
    expect(filterTrades(trades, "wins", "").map((t) => t.s.id)).toEqual(["s1"]);
    expect(filterTrades(trades, "losses", "").map((t) => t.s.id)).toEqual(["s2"]);
    expect(filterTrades(trades, "XAUT", "").map((t) => t.s.id)).toEqual(["s3"]);
    expect(filterTrades(trades, "all", "hedge").map((t) => t.s.id)).toEqual(["s2"]); // a tag
    expect(filterTrades(trades, "all", "run over").map((t) => t.s.id)).toEqual(["s2"]); // the notes
    expect(filterTrades(trades, "all", "butterfly").map((t) => t.s.id)).toEqual(["s1"]); // the template
    expect(filterTrades(trades, "paper", "straddle")).toEqual([]);
  });
  it("csv quotes commas and quotes", () => {
    const csv = journalCsv(filterTrades(trades, "live", ""));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,name,mode,asset,template,legs,opened,closed,days,realized_pnl,close_reason,tags,notes");
    expect(lines[1]).toBe('s2,ETH Short Straddle,live,ETH,Short Straddle,1,2026-07-10,2026-07-24,14,-1.32,,earnings hedge,"got run over, ""call"" side"');
    expect(lines).toHaveLength(2);
  });
  it("HC-TR-164 carries why a trade closed into the row and the CSV, blank when it was closed before reasons existed", () => {
    expect(closedTrades([win, loss]).map((t) => [t.s.id, t.reason])).toEqual([["s1", "expired"], ["s2", null]]);
    expect(reasonLabel("outside_app")).toBe("closed outside the app");
    expect(reasonLabel(null)).toBe("");
    expect(journalCsv(closedTrades([win])).split(String.fromCharCode(10))[1]).toContain(",1.44,expired,");
  });
});

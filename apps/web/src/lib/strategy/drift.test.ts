import type { LivePosition, Strategy } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { driftFor, isSettling, shortfallFor } from "./drift";

const leg = (symbol: string, side: "buy" | "sell", lots: number, status: "open" | "squared_off" = "open") => ({ id: `l_${symbol}_${side}_${lots}`, kind: "put" as const, side, strike: "78000", expiry: "2026-09-25", symbol, lots, price: "900", entryPrice: "900", exitPrice: null, iv: 0.5, status, isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null });
const strat = (id: string, status: Strategy["status"], legs: Strategy["legs"]): Strategy => ({ id, name: id, asset: "BTC", venue: "delta_india", status, tradingMode: status === "paper" ? "paper" : "live", templateName: "", brokerId: "brk_delta", legs, realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: null, closedAt: null, createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-08T10:00:00Z" });
const pos = (symbol: string, size: number, contractValue = "0.001"): LivePosition => ({ productId: 1, symbol, size, entryPrice: "900", realizedPnl: "0", margin: "10", contractValue, mark: "950" });
const lotSize = () => "0.001";

describe("HC-TR-160 drift between the exchange and the strategies", () => {
  const P = "P-BTC-78000-250926";
  const C = "C-BTC-80000-250926";
  it("is empty when the exchange holds exactly what the open live legs add up to", () => {
    const live = [strat("a", "live", [leg(P, "sell", 800), leg(C, "sell", 800)]), strat("b", "live", [leg(P, "sell", 200)]), strat("p", "paper", [leg(P, "sell", 999)])];
    expect(driftFor([pos(P, -1000), pos(C, -800), pos("X-UNTRACKED", 5)], live, lotSize).size).toBe(0);
  });
  it("flags every live strategy on a contract the exchange no longer holds as expected, with the signed figures", () => {
    const live = [strat("a", "live", [leg(P, "sell", 800), leg(C, "sell", 800)]), strat("b", "live", [leg(P, "sell", 200)])];
    const d = driftFor([pos(C, -800)], live, lotSize); // the stop closed all 1,000 puts
    expect([...d.keys()].sort()).toEqual(["a", "b"]);
    expect(d.get("a")).toEqual([{ symbol: P, expected: -1000, held: 0, strategies: ["a", "b"] }]);
    expect(d.get("b")).toEqual(d.get("a"));
    // a position that cannot be sized to whole lots (5 contracts of 0.0003 at a 0.001 lot) or has no product data is
    // unknown: its contract is left out rather than read as "the exchange holds nothing"
    expect(driftFor([pos(P, -5, "0.0003"), pos(C, -800)], live, lotSize).size).toBe(0);
    expect(driftFor([{ ...pos(P, -1000), contractValue: null }, pos(C, -800)], live, lotSize).size).toBe(0);
    // a squared-off leg, and a leg whose entry never filled (resting limit, refused order), are not expected at the exchange
    expect(driftFor([pos(C, -800)], [strat("a", "live", [leg(P, "sell", 800, "squared_off"), leg(C, "sell", 800)])], lotSize).size).toBe(0);
    expect(driftFor([pos(C, -800)], [strat("a", "live", [{ ...leg(P, "sell", 800), entryPrice: null }, leg(C, "sell", 800)])], lotSize).size).toBe(0);
    // a leg past its settlement instant (25 Sep 12:00 UTC for BTC) belongs to the settler, not the drift check
    const after = Date.UTC(2026, 8, 25, 12, 1);
    expect(driftFor([], [strat("a", "live", [leg(P, "sell", 800)])], lotSize, after).size).toBe(0);
    expect(driftFor([], [strat("a", "live", [leg(P, "sell", 800)])], lotSize, after - 120_000).size).toBe(1);
    // still open long after the window (no spot, no credential): out of sync again, Reconcile is the way out
    expect(driftFor([], [strat("a", "live", [leg(P, "sell", 800)])], lotSize, after + 20 * 60_000).size).toBe(1);
    expect(isSettling("2026-09-25", "BTC", after)).toBe(true);
    expect(isSettling("PERP", "BTC", after)).toBe(false);
  });
  it("shortfallFor gives a leg its share of the missing lots, only on the side that went", () => {
    const row = { symbol: P, expected: -1000, held: -200, strategies: ["a", "b"] };
    expect(shortfallFor(row, { side: "sell", lots: 800 })).toBe(800);
    expect(shortfallFor(row, { side: "sell", lots: 200 })).toBe(200);
    expect(shortfallFor(row, { side: "buy", lots: 100 })).toBe(0);
    expect(shortfallFor({ symbol: P, expected: -800, held: -1000, strategies: ["a"] }, { side: "sell", lots: 800 })).toBe(0); // the exchange holds more: nothing to book
  });
});

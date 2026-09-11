import type { Strategy } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { lotsWord, overlapsFor } from "./overlap";

const leg = (symbol: string, side: "buy" | "sell", lots: number, status: "open" | "squared_off" = "open") => ({ id: `l_${symbol}_${side}`, kind: "put" as const, side, strike: "78000", expiry: "2026-09-25", symbol, lots, price: "900", entryPrice: "900", exitPrice: null, iv: 0.5, status, isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null });
const strat = (id: string, name: string, status: Strategy["status"], legs: Strategy["legs"]): Strategy => ({ id, name, asset: "BTC", venue: "delta_india", status, tradingMode: status === "archived" ? "live" : status === "draft" ? null : status, templateName: "", brokerId: "brk_delta", legs, realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: null, closedAt: null, createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-08T10:00:00Z" });

describe("HC-TR-159 overlapping contracts across strategies", () => {
  const P = "P-BTC-78000-250926";
  const C = "C-BTC-80000-250926";
  const others = [
    strat("a", "Strangle A", "live", [leg(P, "sell", 800), leg(C, "sell", 800)]),
    strat("b", "Hedge B", "live", [leg(P, "buy", 100), leg(P, "sell", 50, "squared_off")]),
    strat("p", "Paper P", "paper", [leg(P, "sell", 5)]),
    strat("z", "Closed Z", "archived", [leg(P, "sell", 999)]),
  ];
  it("names every open strategy of the same mode holding the contract and nets the lots the exchange will hold", () => {
    const rows = overlapsFor([{ symbol: P, side: "sell", lots: 200, label: "78,000 P · 25 Sep" }, { symbol: "P-BTC-70000-250926", side: "buy", lots: 1, label: "70,000 P" }], others, "live", null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: P, label: "78,000 P · 25 Sep", heldNet: -700, thisNet: -200, afterNet: -900 });
    expect(rows[0]!.held.map((h) => `${h.name}:${h.side}:${h.lots}`)).toEqual(["Strangle A:sell:800", "Hedge B:buy:100"]); // squared-off, paper and archived rows are not held on the exchange
  });
  it("skips the strategy being traded, sums a contract listed twice, and reads paper against paper", () => {
    expect(overlapsFor([{ symbol: P, side: "sell", lots: 1, label: "x" }, { symbol: P, side: "buy", lots: 3, label: "x" }], others, "live", "a")).toMatchObject([{ heldNet: 100, thisNet: 2, afterNet: 102, held: [{ id: "b" }] }]);
    expect(overlapsFor([{ symbol: P, side: "buy", lots: 5, label: "x" }], others, "paper", null)).toMatchObject([{ heldNet: -5, afterNet: 0, held: [{ id: "p" }] }]);
    expect(overlapsFor([{ symbol: C, side: "buy", lots: 1, label: "x" }], others, "paper", null)).toEqual([]);
  });
  it("lotsWord reads as a trader says it", () => {
    expect(lotsWord(-900)).toBe("900 sold");
    expect(lotsWord(1200)).toBe("1,200 bought");
    expect(lotsWord(0)).toBe("flat");
  });
});

// Verified P&L arithmetic (ADR-073; HC-TR-180): average cost per product over the fills in time order, shorts
// signed, flips split, commissions off on their day, unknown products skipped and counted.
import { describe, expect, it } from "vitest";
import { type FillLike, VerifiedPnl, dayBack, sumSince, verifiedFromFills } from "./verified.js";

const cv = (productId: number, _symbol: string | null, stored?: string | null) => stored ?? (productId === 999 ? null : "0.001"); // one BTC option contract = 0.001 BTC
const fill = (o: Partial<FillLike> & Pick<FillLike, "side" | "size" | "price">): FillLike => ({ productId: 101, symbol: "C-BTC-80000-250926", commission: "0", filledAt: "2026-09-10T09:00:00.000Z", ...o });

describe("HC-TR-180 verifiedFromFills", () => {
  it("a long round trip realises (exit − entry) × contracts × contract value, less both commissions, on the closing day", () => {
    const r = verifiedFromFills(
      [fill({ side: "buy", size: 10, price: "1200", commission: "0.6", filledAt: "2026-09-10T09:00:00.000Z" }), fill({ side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: "2026-09-11T09:00:00.000Z" })],
      cv,
    );
    // (1500 − 1200) × 10 × 0.001 = 3.00; commissions 1.35
    expect(r.realizedUsd).toBe(1.65);
    expect(r.commissionUsd).toBe(1.35);
    expect(r.byDay).toEqual([
      { day: "2026-09-10", pnl: "-0.6" },
      { day: "2026-09-11", pnl: "2.25" },
    ]);
    expect(r.skipped).toBe(0);
  });

  it("a short round trip is signed the other way, and the average moves as a position is added to", () => {
    const r = verifiedFromFills(
      [
        fill({ side: "sell", size: 10, price: "900" }),
        fill({ side: "sell", size: 10, price: "1100", filledAt: "2026-09-10T10:00:00.000Z" }), // average 1000 short 20
        fill({ side: "buy", size: 20, price: "800", filledAt: "2026-09-11T09:00:00.000Z" }), // (800 − 1000) × 20 × 0.001 × −1 = +4
      ],
      cv,
    );
    expect(r.realizedUsd).toBe(4);
    expect(r.byDay).toEqual([{ day: "2026-09-11", pnl: "4" }]);
  });

  it("a fill that flips the side closes the old position and opens the rest at its own price", () => {
    const r = verifiedFromFills(
      [
        fill({ side: "buy", size: 10, price: "1000" }),
        fill({ side: "sell", size: 15, price: "1200", filledAt: "2026-09-11T09:00:00.000Z" }), // closes 10 for +2, opens 5 short at 1200
        fill({ side: "buy", size: 5, price: "1100", filledAt: "2026-09-12T09:00:00.000Z" }), // (1100 − 1200) × 5 × 0.001 × −1 = +0.5
      ],
      cv,
    );
    expect(r.realizedUsd).toBe(2.5);
    expect(r.byDay.map((d) => d.pnl)).toEqual(["2", "0.5"]);
  });

  it("fills are taken in time order whatever the input order; products are kept apart; an unknown product is skipped and counted", () => {
    const r = verifiedFromFills(
      [
        fill({ side: "sell", size: 10, price: "1500", filledAt: "2026-09-11T09:00:00.000Z" }),
        fill({ side: "buy", size: 10, price: "1200" }),
        fill({ productId: 102, symbol: "P-BTC-78000-250926", side: "buy", size: 4, price: "50" }), // still open: nothing realised
        fill({ productId: 999, symbol: null, side: "buy", size: 1, price: "1" }),
      ],
      cv,
    );
    expect(r.realizedUsd).toBe(3);
    expect(r.skipped).toBe(1);
  });

  it("a stored contract value wins over the lookup", () => {
    const r = verifiedFromFills([fill({ side: "buy", size: 10, price: "1000", contractValue: "0.01" }), fill({ side: "sell", size: 10, price: "1100", filledAt: "2026-09-11T09:00:00.000Z", contractValue: "0.01" })], cv);
    expect(r.realizedUsd).toBe(10); // (1100 − 1000) × 10 × 0.01
  });

  it("a zero-size fill is skipped; nothing in, nothing out", () => {
    expect(verifiedFromFills([fill({ side: "buy", size: 0, price: "1" })], cv)).toEqual({ realizedUsd: 0, commissionUsd: 0, byDay: [], skipped: 1 });
    expect(verifiedFromFills([], cv)).toEqual({ realizedUsd: 0, commissionUsd: 0, byDay: [], skipped: 0 });
  });

  it("sumSince and dayBack cut the day series for the 7 and 30 day totals", () => {
    const days = [
      { day: "2026-09-01", pnl: "1" },
      { day: "2026-09-10", pnl: "2.5" },
      { day: "2026-09-12", pnl: "-0.25" },
    ];
    const now = Date.UTC(2026, 8, 12, 12);
    expect(dayBack(now, 7)).toBe("2026-09-05");
    expect(sumSince(days, dayBack(now, 7))).toBe(2.25);
    expect(sumSince(days, dayBack(now, 30))).toBe(3.25);
    expect(sumSince(days, "0000-00-00")).toBe(3.25);
  });

  it("the wire shape is strict", () => {
    const ok = VerifiedPnl.safeParse({
      accounts: [{ accountId: "crd_1", label: "Main", fills: 2, lastReadAt: "2026-09-12T09:00:00.000Z", lastFillAt: "2026-09-11T09:00:00.000Z", since: "2026-09-10T09:00:00.000Z", realizedUsd: "1.65", commissionUsd: "1.35", byDay: [{ day: "2026-09-11", pnl: "2.25" }], skipped: 0, partialProducts: 0, backfilling: false, error: null }],
      total: { all: "1.65", gross: "3", d7: "1.65", d30: "1.65", commission: "1.35" },
      fills: 2,
      lastReadAt: "2026-09-12T09:00:00.000Z",
      since: "2026-09-10T09:00:00.000Z",
      journalRealizedUsd: "1.65",
      difference: "0",
    });
    expect(ok.success).toBe(true);
    expect(VerifiedPnl.safeParse({ accounts: [], total: { all: "0", gross: "0", d7: "0", d30: "0", commission: "0" }, fills: 0, lastReadAt: null, since: null, journalRealizedUsd: "0", difference: "0", extra: 1 }).success).toBe(false);
  });
});

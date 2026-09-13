// Mindful Trading pause: the day figure and the pause rule (ADR-074; HC-TR-182).
import type { MindfulSettings, Strategy } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { type DayBook, liveDayPnl, mindfulFor, refusedMindful, serverMindful, shouldPause } from "./mindful";

const TODAY = "2026-09-12";
const AT = "2026-09-08T10:00:00Z";
const LEG = { id: "leg_1", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: AT, closedAt: null, orderId: null };
function strat(id: string, over: Partial<Strategy> = {}): Strategy {
  return { id, name: id, asset: "BTC", venue: "delta_india", status: "live", tradingMode: "live", templateName: "Custom", brokerId: "brk_delta", legs: [LEG], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT, ...over };
}
function book(totals: Record<string, number>, unpriced: string[] = []): DayBook {
  return { pnlOf: (s) => ({ total: totals[s.id] ?? 0 }), priceOf: (s) => (unpriced.includes(s.id) ? null : 1250) };
}
const ON: MindfulSettings = { enabled: true, thresholdUsd: "0", pauseSeconds: 30 };

describe("HC-TR-182 today's live P&L", () => {
  it("sums live strategies at today's move and live trades closed today at their realised P&L; paper and older closes never count", () => {
    const rows = [
      strat("a", { pnlHistory: [{ day: "2026-09-11", pnl: "100" }] }), // 20 today after 100 yesterday: −80
      strat("b"), // no point before today: the whole −30 is today's
      strat("c", { status: "archived", closedAt: `${TODAY}T09:00:00Z`, realizedPnl: "-50" }), // closed today: −50
      strat("d", { status: "archived", closedAt: "2026-09-11T09:00:00Z", realizedPnl: "-500" }), // closed yesterday: not today
      strat("e", { status: "paper", tradingMode: "paper" }), // paper never counts
      strat("f", { status: "archived", tradingMode: "paper", closedAt: `${TODAY}T09:00:00Z`, realizedPnl: "-500" }),
    ];
    const day = liveDayPnl(rows, book({ a: 20, b: -30, e: -999 }), TODAY);
    expect(day).toEqual({ pnl: -160, count: 3, closedCount: 1, known: true });
    // a live trade closed today after a point yesterday counts only today's share
    const closedWithHistory = liveDayPnl([strat("g", { status: "archived", closedAt: `${TODAY}T09:00:00Z`, realizedPnl: "40", pnlHistory: [{ day: "2026-09-11", pnl: "100" }] })], book({}), TODAY);
    expect(closedWithHistory.pnl).toBe(-60);
    expect(liveDayPnl(undefined, book({}), TODAY)).toEqual({ pnl: 0, count: 0, closedCount: 0, known: true });
  });

  it("is unknown while an open live leg has no price, and the pause is never decided on a guess", () => {
    const day = liveDayPnl([strat("a"), strat("b")], book({ a: -30, b: -30 }, ["b"]), TODAY);
    expect(day.known).toBe(false);
    expect(shouldPause(ON, day)).toBe(false);
  });

  it("pauses when on, known and below −threshold; never when off, nothing live, or the loss is inside the threshold", () => {
    const down = liveDayPnl([strat("a")], book({ a: -80 }), TODAY);
    expect(shouldPause(ON, down)).toBe(true);
    expect(shouldPause({ ...ON, enabled: false }, down)).toBe(false);
    expect(shouldPause(undefined, down)).toBe(false);
    expect(shouldPause({ ...ON, thresholdUsd: "100" }, down)).toBe(false);
    expect(shouldPause({ ...ON, thresholdUsd: "79.99" }, down)).toBe(true);
    expect(shouldPause(ON, liveDayPnl([strat("a")], book({ a: 5 }), TODAY))).toBe(false);
    expect(shouldPause(ON, liveDayPnl([strat("a")], book({ a: 0 }), TODAY))).toBe(false); // flat is not down
    expect(shouldPause(ON, liveDayPnl([], book({}), TODAY))).toBe(false);
    const info = mindfulFor({ ...ON, thresholdUsd: "10", pauseSeconds: 45 }, [strat("a")], book({ a: -80 }), TODAY);
    expect(info).toEqual({ day: down, seconds: 45, thresholdUsd: 10, source: "browser" });
    expect(mindfulFor(ON, [strat("a")], book({ a: 80 }), TODAY)).toBeNull();
    expect(mindfulFor(undefined, [strat("a")], book({ a: -80 }), TODAY)).toBeNull();
  });
});

describe("HC-TR-189 the server's verdict (ADR-084)", () => {
  const day = { pnlUsd: "-80.00", count: 2, closedCount: 1, known: true };
  it("is undefined while the server has no figure, null when the server says no pause, and the pause otherwise", () => {
    expect(serverMindful(undefined)).toBeUndefined();
    expect(serverMindful(null)).toBeUndefined();
    expect(serverMindful({ day: { ...day, known: false }, pause: { seconds: 30, thresholdUsd: "0", basis: "since 05:30 IST (00:00 UTC)" } })).toBeUndefined();
    expect(serverMindful({ day, pause: null })).toBeNull();
    expect(serverMindful({ day, pause: { seconds: 45, thresholdUsd: "10", basis: "since 05:30 IST (00:00 UTC)" } })).toEqual({ day: { pnl: -80, count: 2, closedCount: 1, known: true }, seconds: 45, thresholdUsd: 10, source: "server" });
  });
  it("a refused entry carries the pause with the server's seconds left; any other error is not a pause", () => {
    const pause = { seconds: 45, thresholdUsd: "10", basis: "since 05:30 IST (00:00 UTC)" };
    expect(refusedMindful(new ApiError(409, "MINDFUL_PAUSE", "wait", { waitS: 12, day, pause }))).toEqual({ day: { pnl: -80, count: 2, closedCount: 1, known: true }, seconds: 12, thresholdUsd: 10, source: "server" });
    expect(refusedMindful(new ApiError(409, "MINDFUL_PAUSE", "wait", { day, pause }))?.seconds).toBe(45); // no seconds given: the whole pause
    expect(refusedMindful(new ApiError(409, "MINDFUL_PAUSE", "wait"))).toBeNull(); // no figures to show
    expect(refusedMindful(new ApiError(409, "CONFLICT", "kill switch", { waitS: 12, day, pause }))).toBeNull();
    expect(refusedMindful(new Error("network"))).toBeNull();
  });
});

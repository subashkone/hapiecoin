// GAPS #38 / ADR-029: the browser writes today's P&L point for active strategies after a short delay and then
// every five minutes, only when the value moved, and never for a strategy with an unpriced leg.
import type { Strategy } from "@hapiecoin/schema";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import type { PaperBook } from "./usePaper";
import { PNL_WRITE_EVERY_MS, PNL_WRITE_FIRST_MS, todayIso, usePnlWriter } from "./usePnlWriter";

const EMAIL = "pnl@example.com";
let mock: MockFetch;
const AT = "2026-09-08T10:00:00Z";
const LEG = { id: "leg_1", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: AT, closedAt: null, orderId: null };
const strat = (id: string, status: Strategy["status"] = "paper"): Strategy => ({ id, name: id, asset: "BTC", status, tradingMode: status === "draft" ? null : "paper", templateName: "Custom", brokerId: "brk_delta", legs: [LEG], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT });

function bookWith(total: number, priced = true): PaperBook {
  return {
    priceOf: () => (priced ? 1250 : null),
    pnlOf: () => ({ total, unrealized: total, realized: 0, perLeg: {} }),
    spotOf: () => 80_000,
    lotSizeOf: () => "0.001",
    money: { currency: "USD", rate: "1" },
    brokerName: () => "Delta",
    version: 0,
  } as unknown as PaperBook;
}
function Writer({ strategies, book, enabled = true }: { strategies: Strategy[]; book: PaperBook; enabled?: boolean }) {
  usePnlWriter(strategies, book, enabled);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
});
afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

describe("[STRATEGY] daily P&L writer", () => {
  it("todayIso is the UTC calendar day", () => {
    expect(todayIso(new Date("2026-09-08T23:59:00Z"))).toBe("2026-09-08");
  });

  it("writes one point per active strategy after the first delay, skips unpriced and inactive ones, and rewrites only when the total moved", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat("s_paper"), strat("s_live", "live"), strat("s_draft", "draft"));
    const view = renderWithProviders(<Writer strategies={acc.strategies.slice()} book={bookWith(1.5)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_WRITE_FIRST_MS + 50);
    });
    expect(acc.strategies.find((s) => s.id === "s_paper")!.pnlHistory).toEqual([{ day: todayIso(), pnl: "1.5" }]);
    expect(acc.strategies.find((s) => s.id === "s_live")!.pnlHistory).toEqual([{ day: todayIso(), pnl: "1.5" }]);
    expect(acc.strategies.find((s) => s.id === "s_draft")!.pnlHistory).toEqual([]);
    // same total five minutes later: nothing is sent again
    const before = mock.calls.filter((c) => c.url.includes("/pnl")).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_WRITE_EVERY_MS + 50);
    });
    expect(mock.calls.filter((c) => c.url.includes("/pnl")).length).toBe(before);
    // the total moved: today's point is upserted
    view.rerender(<Writer strategies={acc.strategies.slice()} book={bookWith(-0.25)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_WRITE_FIRST_MS + 50);
    });
    expect(acc.strategies.find((s) => s.id === "s_paper")!.pnlHistory).toEqual([{ day: todayIso(), pnl: "-0.25" }]);
  });

  it("waits while a leg has no quote and does nothing when disabled", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat("s_paper"));
    renderWithProviders(<Writer strategies={acc.strategies.slice()} book={bookWith(3, false)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_WRITE_FIRST_MS + 50);
    });
    expect(acc.strategies[0]!.pnlHistory).toEqual([]);
    renderWithProviders(<Writer strategies={acc.strategies.slice()} book={bookWith(3)} enabled={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_WRITE_FIRST_MS + 50);
    });
    expect(acc.strategies[0]!.pnlHistory).toEqual([]);
  });
});

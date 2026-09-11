import { describe, expect, it } from "vitest";
import {
  AdjustBody,
  CloseLegBody,
  ReconcileBody,
  LivePreviewBody,
  MAX_ADJUST_REASON,
  MAX_NEW_LEGS,
  StopBody,
  Strategy,
  StrategyCreate,
  StrategyLegInput,
  StrategyAdjustment,
  StrategyStart,
  realizedPnl,
  toDecimal,
  CLOSE_REASONS,
  CLOSE_REASON_LABELS,
  CloseReason,
  settlementHourUtc,
  settlementMsOf,
} from "./strategies.js";

const call = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200.5", iv: 0.52 } as const;
const fut = { kind: "future", side: "sell", strike: "", expiry: "PERP", symbol: "BTCUSD", lots: 2, price: "79521" } as const;

describe("[SCHEMA] strategies (ADR-024)", () => {
  it("accepts option and future legs and rejects mixed-up shapes", () => {
    expect(StrategyLegInput.safeParse(call).success).toBe(true);
    expect(StrategyLegInput.safeParse(fut).success).toBe(true);
    expect(StrategyLegInput.safeParse({ ...call, strike: "" }).success).toBe(false);
    expect(StrategyLegInput.safeParse({ ...call, expiry: "PERP" }).success).toBe(false);
    expect(StrategyLegInput.safeParse({ ...fut, strike: "80000" }).success).toBe(false);
    expect(StrategyLegInput.safeParse({ ...call, lots: 0 }).success).toBe(false);
    expect(StrategyLegInput.safeParse({ ...call, price: "-1" }).success).toBe(false);
    expect(StrategyLegInput.safeParse({ ...call, extra: 1 }).success).toBe(false);
  });

  it("HC-TR-017 a new strategy takes 1..8 legs and needs a name", () => {
    const ok = StrategyCreate.safeParse({ name: "  Iron Condor ", asset: "BTC", legs: [call] });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.name).toBe("Iron Condor");
      expect(ok.data.templateName).toBe("Custom");
    }
    expect(StrategyCreate.safeParse({ name: " ", asset: "BTC", legs: [call] }).success).toBe(false);
    expect(StrategyCreate.safeParse({ name: "x", asset: "BTC", legs: [] }).success).toBe(false);
    expect(StrategyCreate.safeParse({ name: "x", asset: "BTC", legs: Array.from({ length: MAX_NEW_LEGS + 1 }, () => call) }).success).toBe(false);
  });

  it("start, close and stop bodies", () => {
    expect(StrategyStart.safeParse({ mode: "paper", brokerId: "brk_1", entries: { leg_1: "1200" } }).success).toBe(true);
    expect(StrategyStart.safeParse({ mode: "paper", brokerId: "brk_1", entries: { leg_1: "abc" } }).success).toBe(false);
    expect(CloseLegBody.safeParse({ exitPrice: "10", lots: 3 }).success).toBe(true);
    expect(CloseLegBody.safeParse({ exitPrice: "10", lots: 0 }).success).toBe(false);
    // HC-TR-161: reconcile books lots closed outside the app; at least one leg, whole lots, a price, an optional reason
    expect(ReconcileBody.safeParse({ legs: [{ legId: "leg_1", price: "10" }, { legId: "leg_2", lots: 3, price: "0" }], reason: " stop hit " }).success).toBe(true);
    expect(ReconcileBody.safeParse({ legs: [] }).success).toBe(false);
    expect(ReconcileBody.safeParse({ legs: [{ legId: "leg_1", lots: 0, price: "10" }] }).success).toBe(false);
    expect(ReconcileBody.safeParse({ legs: [{ legId: "leg_1", price: "-1" }] }).success).toBe(false);
    const stop = StopBody.parse({ archive: false });
    expect(stop.exits).toEqual({});
  });

  it("a full Strategy round-trips", () => {
    const s = {
      id: "strat_1",
      name: "Long straddle",
      asset: "BTC",
      status: "paper",
      tradingMode: "paper",
      templateName: "Long Straddle",
      brokerId: "brk_delta",
      legs: [{ id: "leg_1", ...call, iv: 0.52, entryPrice: "1200.5", exitPrice: null, status: "open", isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null }],
      realizedPnl: "0",
      pnlHistory: [{ day: "2026-09-08", pnl: "12.5" }],
      notes: "",
      tags: [],
      orderBatchId: null,
      adjustments: [{ id: "adj_1", at: "2026-09-08T11:00:00Z", reason: "spot ran above the wings", added: 1, trimmed: 1, closed: 0, realizedPnl: "0.4", batchId: "key-adj-000001" }],
      startedAt: "2026-09-08T10:00:00Z",
      closedAt: null,
      createdAt: "2026-09-08T09:00:00Z",
      updatedAt: "2026-09-08T10:00:00Z",
    };
    expect(Strategy.safeParse(s).success).toBe(true);
    const { adjustments, ...bare } = s;
    expect(adjustments).toHaveLength(1);
    expect(Strategy.parse(bare).adjustments).toEqual([]); // older payloads default to no history
  });

  it("ADR-044 an adjustment batch needs at least one add or change; lots after are whole and non-negative; the reason is trimmed and capped", () => {
    const change = { legId: "leg_1", lotsAfter: 4, price: "1300" };
    expect(AdjustBody.safeParse({ adds: [call] }).success).toBe(true);
    expect(AdjustBody.safeParse({ changes: [change] }).success).toBe(true);
    expect(AdjustBody.safeParse({}).success).toBe(false);
    expect(AdjustBody.safeParse({ adds: [], changes: [] }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [{ ...change, lotsAfter: -1 }] }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [{ ...change, lotsAfter: 1.5 }] }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [{ ...change, price: "-1" }] }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [change], nope: 1 }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [change], idempotencyKey: "short" }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [change], expected: { "C-BTC-80000-250926": "0" } }).success).toBe(false); // a zero mark cannot anchor a band
    expect(AdjustBody.safeParse({ changes: [change], reason: "x".repeat(MAX_ADJUST_REASON + 1) }).success).toBe(false);
    const full = AdjustBody.parse({ adds: [call], changes: [change], expected: { "C-BTC-80000-250926": "1200" }, idempotencyKey: "key-adj-000001", reason: "  spot ran  " });
    expect(full.reason).toBe("spot ran");
    expect(full.orderType).toBe("market");
    expect(AdjustBody.parse({ adds: [call], orderType: "limit" }).orderType).toBe("limit");
    expect(AdjustBody.safeParse({ adds: [call], orderType: "stop" }).success).toBe(false);
    expect(AdjustBody.parse({ changes: [change] })).toMatchObject({ adds: [], expected: {} });
    expect(StrategyAdjustment.safeParse({ id: "adj_1", at: "2026-09-08T11:00:00Z", reason: null, added: 0, trimmed: 0, closed: 2, realizedPnl: "-1.2", batchId: null }).success).toBe(true);
    expect(StrategyAdjustment.safeParse({ id: "adj_1", at: "2026-09-08T11:00:00Z", reason: null, added: -1, trimmed: 0, closed: 0, realizedPnl: "0", batchId: null }).success).toBe(false);
    // the live preview prices the open legs by default, or the proposed batch when overrides are sent
    expect(LivePreviewBody.safeParse({ brokerId: "brk_1" }).success).toBe(true);
    expect(LivePreviewBody.safeParse({ brokerId: "brk_1", adds: [call], changes: [change] }).success).toBe(true);
    expect(LivePreviewBody.safeParse({ brokerId: "brk_1", changes: [{ legId: "leg_1" }] }).success).toBe(false);
  });

  it("realised P&L is (exit − entry) × lots × lot size × side, as a decimal string", () => {
    expect(realizedPnl({ side: "buy", lots: 10, entryPrice: "1000", exitPrice: "1100" }, "0.001")).toBe("1");
    expect(realizedPnl({ side: "sell", lots: 10, entryPrice: "1000", exitPrice: "1100" }, "0.001")).toBe("-1");
    expect(realizedPnl({ side: "buy", lots: 3, entryPrice: "10.5", exitPrice: "10.5" }, "0.01")).toBe("0");
    expect(realizedPnl({ side: "buy", lots: 3, entryPrice: null, exitPrice: "1" }, "0.01")).toBe("0");
    expect(toDecimal(-0.001)).toBe("0");
    expect(toDecimal(12.345)).toBe("12.35");
    expect(toDecimal(Number.NaN)).toBe("0");
  });
});

describe("close reasons and settlement instants (ADR-059 §2.4)", () => {
  it("names every reason and settles BTC / ETH at 12:00 UTC, XAUT at 16:00 UTC, never the perpetual", () => {
    expect(CLOSE_REASONS.map((r) => CLOSE_REASON_LABELS[r])).toEqual(["expired", "squared off", "stopped", "closed outside the app"]);
    expect(CloseReason.safeParse("liquidated").success).toBe(false);
    expect(settlementMsOf("2026-09-25", "BTC")).toBe(Date.UTC(2026, 8, 25, 12));
    expect(settlementMsOf("2026-09-25", "XAUT")).toBe(Date.UTC(2026, 8, 25, 16));
    expect(settlementMsOf("PERP", "ETH")).toBeNull();
    expect(settlementMsOf("2026-02-30", "ETH")).toBeNull();
    expect(settlementHourUtc("ETH")).toBe(12);
  });
});

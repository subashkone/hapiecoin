import { describe, expect, it } from "vitest";
import {
  CloseLegBody,
  MAX_NEW_LEGS,
  StopBody,
  Strategy,
  StrategyCreate,
  StrategyLegInput,
  StrategyStart,
  realizedPnl,
  toDecimal,
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
      startedAt: "2026-09-08T10:00:00Z",
      closedAt: null,
      createdAt: "2026-09-08T09:00:00Z",
      updatedAt: "2026-09-08T10:00:00Z",
    };
    expect(Strategy.safeParse(s).success).toBe(true);
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

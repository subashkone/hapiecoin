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
  RuleBody,
  RulesBody,
  ruleThresholdUsd,
  ruleLevel,
  nearestSettlement,
  RULE_KINDS,
  RULE_KIND_ORDER,
  CLOSE_REASON_OF_KIND,
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
      venue: "delta_india",
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

describe("HC-TR-165 stop and target rules (ADR-059 §2.3)", () => {
  it("validates one rule per kind, a basis for percentages, and turns a rule into its USD level", () => {
    expect(RulesBody.safeParse({ rules: [{ kind: "stop", trigger: "money", value: "60" }, { kind: "target", trigger: "pct", value: "50", basis: "credit", basisUsd: "100" }] }).success).toBe(true);
    expect(RulesBody.safeParse({ rules: [{ kind: "stop", trigger: "money", value: "60" }, { kind: "stop", trigger: "money", value: "70" }] }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "stop", trigger: "pct", value: "200" }).success).toBe(false); // no basis
    expect(RuleBody.safeParse({ kind: "stop", trigger: "money", value: "0" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "stop", trigger: "pct", value: "1500", basis: "credit", basisUsd: "1" }).success).toBe(false); // over 1000 %
    expect(RuleBody.safeParse({ kind: "target", trigger: "pct", value: "1", basis: "credit", basisUsd: "0.3" }).success).toBe(false); // rounds to 0
    expect(RuleBody.parse({ kind: "stop", trigger: "money", value: "60" }).channels).toEqual(["push"]);
    expect(ruleThresholdUsd({ kind: "stop", trigger: "money", value: "60" })).toBe("-60");
    expect(ruleThresholdUsd({ kind: "target", trigger: "pct", value: "50", basisUsd: "100" })).toBe("50");
    expect(ruleThresholdUsd({ kind: "stop", trigger: "pct", value: "200", basisUsd: "84" })).toBe("-168");
    expect(CLOSE_REASON_LABELS.target).toBe("target hit");
  });
  it("HC-TR-169 leg stop, spot level and time exit: triggers per kind, the leg for a leg stop, the stored level per kind", () => {
    expect(RuleBody.safeParse({ kind: "leg_stop", trigger: "multiple", value: "2.5", legId: "leg_1" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "leg_stop", trigger: "multiple", value: "2.5" }).success).toBe(false); // no leg
    expect(RuleBody.safeParse({ kind: "leg_stop", trigger: "money", value: "5", legId: "leg_1" }).success).toBe(false); // wrong trigger
    expect(RuleBody.safeParse({ kind: "spot", trigger: "below", value: "78000" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "spot", trigger: "below", value: "78000", scope: "leg" }).success).toBe(false); // only a leg stop exits one leg
    expect(RuleBody.safeParse({ kind: "time", trigger: "at", value: "2026-09-12T11:30:00.000Z" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "time", trigger: "at", value: "tomorrow" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "time", trigger: "at", value: "2026-09-12T11:30" }).success).toBe(false); // no zone: whose clock?
    expect(RuleBody.safeParse({ kind: "time", trigger: "at", value: "2026-09-12T17:00:00+05:30" }).success).toBe(true);
    expect(RulesBody.safeParse({ rules: Array.from({ length: 15 }, (_, i) => ({ kind: "leg_stop", trigger: "price", value: "1", legId: `l${i}` })) }).success).toBe(false); // 14 is the most: ten leg stops and the four others
    expect(nearestSettlement([{ expiry: "PERP" }], "BTC")).toBeNull();
    expect(nearestSettlement([{ expiry: "2026-09-25" }, { expiry: "2026-09-18" }, { expiry: "PERP" }], "BTC")).toEqual({ ms: Date.UTC(2026, 8, 18, 12), expiry: "2026-09-18" });
    expect(RuleBody.safeParse({ kind: "time", trigger: "dte", value: "0" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "time", trigger: "dte", value: "1.5" }).success).toBe(false);
    expect(RulesBody.safeParse({ rules: [{ kind: "leg_stop", trigger: "price", value: "50", legId: "a" }, { kind: "leg_stop", trigger: "price", value: "60", legId: "b" }, { kind: "spot", trigger: "above", value: "82000" }] }).success).toBe(true);
    expect(RulesBody.safeParse({ rules: [{ kind: "leg_stop", trigger: "price", value: "50", legId: "a" }, { kind: "leg_stop", trigger: "price", value: "60", legId: "a" }] }).success).toBe(false);
    expect(ruleLevel({ kind: "leg_stop", trigger: "multiple", value: "2.5", basisUsd: undefined }, "48.10")).toBe("120.25");
    expect(ruleLevel({ kind: "leg_stop", trigger: "price", value: "150", basisUsd: undefined })).toBe("150");
    expect(ruleLevel({ kind: "spot", trigger: "below", value: "78000", basisUsd: undefined })).toBe("78000");
    expect(ruleLevel({ kind: "time", trigger: "at", value: "2026-09-12T11:30:00.000Z", basisUsd: undefined })).toBe(String(Date.UTC(2026, 8, 12, 11, 30)));
    expect(ruleLevel({ kind: "time", trigger: "dte", value: "1", basisUsd: undefined })).toBe("1");
    expect(ruleLevel({ kind: "stop", trigger: "money", value: "60", basisUsd: undefined })).toBe("-60");
    expect(RULE_KINDS.map((k) => RULE_KIND_ORDER[k])).toEqual([0, 4, 1, 2, 3]);
    expect(CLOSE_REASON_OF_KIND.time).toBe("squared_off");
    expect(CLOSE_REASON_OF_KIND.leg_stop).toBe("stopped");
  });
});

describe("close reasons and settlement instants (ADR-059 §2.4)", () => {
  it("names every reason and settles BTC / ETH at 12:00 UTC, XAUT at 16:00 UTC, never the perpetual", () => {
    expect(CLOSE_REASONS.map((r) => CLOSE_REASON_LABELS[r])).toEqual(["expired", "squared off", "stopped", "target hit", "closed outside the app"]);
    expect(CloseReason.safeParse("liquidated").success).toBe(false);
    expect(settlementMsOf("2026-09-25", "BTC")).toBe(Date.UTC(2026, 8, 25, 12));
    expect(settlementMsOf("2026-09-25", "XAUT")).toBe(Date.UTC(2026, 8, 25, 16));
    expect(settlementMsOf("PERP", "ETH")).toBeNull();
    expect(settlementMsOf("2026-02-30", "ETH")).toBeNull();
    expect(settlementHourUtc("ETH")).toBe(12);
  });
});

describe("HC-TR-186 the typed LIVE confirmation (ADR-078)", () => {
  it("reads the word case-insensitively with spaces around it, and nothing else", async () => {
    const { isLiveConfirm, LIVE_CONFIRM_WORD, LivePlaceBody, LiveBatchBody, LiveRetryBody, AdjustBody } = await import("./strategies.js");
    expect(LIVE_CONFIRM_WORD).toBe("LIVE");
    expect(isLiveConfirm("LIVE")).toBe(true);
    expect(isLiveConfirm(" live ")).toBe(true);
    expect(isLiveConfirm("Live")).toBe(true);
    for (const bad of ["", "LIV", "LIVE!", "yes", undefined, null]) expect(isLiveConfirm(bad)).toBe(false);
    const place = { brokerId: "brk_1", idempotencyKey: "key-12345678", expected: {} };
    expect(LivePlaceBody.safeParse(place).success).toBe(true); // the route, not the schema, refuses the missing word with its sentence
    expect(LivePlaceBody.safeParse({ ...place, confirm: "LIVE" }).success).toBe(true);
    expect(LivePlaceBody.safeParse({ ...place, confirm: "x".repeat(17) }).success).toBe(false);
    expect(LiveBatchBody.safeParse({ ids: ["s_1"], brokerId: "brk_1", idempotencyKey: "key-12345678", confirm: "LIVE" }).success).toBe(true);
    expect(LiveRetryBody.safeParse({ confirm: "LIVE" }).success).toBe(true);
    expect(LiveRetryBody.safeParse({}).success).toBe(true);
    expect(LiveRetryBody.safeParse({ confirm: "LIVE", extra: 1 }).success).toBe(false);
    expect(AdjustBody.safeParse({ changes: [{ legId: "leg_1", lotsAfter: 0, price: "1" }], confirm: "LIVE" }).success).toBe(true);
  });
});

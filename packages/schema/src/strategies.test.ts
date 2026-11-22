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
  trailFloorUsd,
  ruleLevel,
  settleInstantMs,
  nearestSettlement,
  RULE_KINDS,
  RULE_KIND_ORDER,
  CLOSE_REASON_OF_KIND,
  LEG_TRAIL_DEFAULT_PCT,
  REST_TRAIL_MIN_GIVE_USD,
  restTrailFloorUsd,
  RULE_KIND_LABELS,
  RULE_TRIGGERS_OF,
  LADDER_STEPS,
  stepLots,
  openProfitPct,
  openPremium,
  stepPremiumOk,
  STEP_MIN_NET_SHARE,
  isLockArmed,
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
    expect(RulesBody.safeParse({ rules: Array.from({ length: 30 }, (_, i) => ({ kind: "leg_stop", trigger: "price", value: "1", legId: `l${i}` })) }).success).toBe(false); // 29 is the most: ten leg stops, ten leg buy-backs (ADR-123), the five others (a running trail on the rest among them, ADR-104) and four profit steps (ADR-120)
    expect(nearestSettlement([{ expiry: "PERP" }], "BTC")).toBeNull();
    expect(nearestSettlement([{ expiry: "2026-09-25" }, { expiry: "2026-09-18" }, { expiry: "PERP" }], "BTC")).toEqual({ ms: Date.UTC(2026, 8, 18, 12), expiry: "2026-09-18" });
    expect(RuleBody.safeParse({ kind: "time", trigger: "dte", value: "0" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "time", trigger: "dte", value: "1.5" }).success).toBe(false);
    // HC-TR-199 a settle rule takes whole minutes, one to twelve hours, and fires at the nearest settlement less those minutes
    expect(RuleBody.safeParse({ kind: "time", trigger: "settle", value: "15" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "time", trigger: "settle", value: "0" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "time", trigger: "settle", value: "721" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "time", trigger: "settle", value: "2.5" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "stop", trigger: "settle", value: "15" }).success).toBe(false);
    expect(settleInstantMs("15", Date.UTC(2026, 10, 7, 12))).toBe(Date.UTC(2026, 10, 7, 11, 45));
    expect(settleInstantMs("15", null)).toBeNull();
    expect(RulesBody.safeParse({ rules: [{ kind: "leg_stop", trigger: "price", value: "50", legId: "a" }, { kind: "leg_stop", trigger: "price", value: "60", legId: "b" }, { kind: "spot", trigger: "above", value: "82000" }] }).success).toBe(true);
    expect(RulesBody.safeParse({ rules: [{ kind: "leg_stop", trigger: "price", value: "50", legId: "a" }, { kind: "leg_stop", trigger: "price", value: "60", legId: "a" }] }).success).toBe(false);
    expect(ruleLevel({ kind: "leg_stop", trigger: "multiple", value: "2.5", basisUsd: undefined }, "48.10")).toBe("120.25");
    expect(ruleLevel({ kind: "leg_stop", trigger: "price", value: "150", basisUsd: undefined })).toBe("150");
    expect(ruleLevel({ kind: "spot", trigger: "below", value: "78000", basisUsd: undefined })).toBe("78000");
    expect(ruleLevel({ kind: "time", trigger: "at", value: "2026-09-12T11:30:00.000Z", basisUsd: undefined })).toBe(String(Date.UTC(2026, 8, 12, 11, 30)));
    expect(ruleLevel({ kind: "time", trigger: "dte", value: "1", basisUsd: undefined })).toBe("1");
    expect(ruleLevel({ kind: "stop", trigger: "money", value: "60", basisUsd: undefined })).toBe("-60");
    expect(RULE_KINDS.map((k) => RULE_KIND_ORDER[k])).toEqual([0, 8, 1, 2, 3, 4, 7, 5, 6]); // the trail on the rest (ADR-104) is judged after the protective kinds, before the target
    expect(CLOSE_REASON_OF_KIND.time).toBe("squared_off");
    expect(CLOSE_REASON_OF_KIND.leg_stop).toBe("stopped");
  });
});

describe("HC-TR-210 a target that trails (ADR-103)", () => {
  it("only a target trails; the give-back is positive, below 100 % or below the target", () => {
    const target = { kind: "target", trigger: "money", value: "600" };
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "money", value: "300" } }).success).toBe(true);
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "pct", value: "25" } }).success).toBe(true);
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "money", value: "600" } }).success).toBe(false); // the exit level would be zero
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "money", value: "0" } }).success).toBe(false);
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "money", value: "0.004" } }).success).toBe(false); // under a cent: no give-back at all
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "pct", value: "100" } }).success).toBe(false);
    expect(RuleBody.safeParse({ ...target, trail: { trigger: "price", value: "5" } }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "stop", trigger: "money", value: "600", trail: { trigger: "money", value: "300" } }).success).toBe(false);
    // a percentage target is compared at its USD level: 50 % of 100 = 50
    expect(RuleBody.safeParse({ kind: "target", trigger: "pct", value: "50", basis: "credit", basisUsd: "100", trail: { trigger: "money", value: "49" } }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "target", trigger: "pct", value: "50", basis: "credit", basisUsd: "100", trail: { trigger: "money", value: "50" } }).success).toBe(false);
  });
  it("the exit level is the best less the give-back", () => {
    expect(trailFloorUsd(600, { trigger: "money", value: "300" })).toBe(300);
    expect(trailFloorUsd(1800, { trigger: "money", value: "300" })).toBe(1500);
    expect(trailFloorUsd(1800, { trigger: "pct", value: "25" })).toBe(1350);
  });
});

describe("HC-TR-212 a leg stop that trails the rest (ADR-104)", () => {
  const stop = { kind: "leg_stop", trigger: "multiple", value: "2", legId: "leg_1" };
  it("a leg stop that exits its own leg takes a give-back; one that exits everything does not; a plain leg stop parses as before", () => {
    expect(LEG_TRAIL_DEFAULT_PCT).toBe("10");
    expect(RuleBody.parse(stop)).toEqual({ ...stop, channels: ["push"] }); // no trail key appears on its own
    expect(RuleBody.safeParse({ ...stop, trail: { trigger: "pct", value: LEG_TRAIL_DEFAULT_PCT } }).success).toBe(true);
    expect(RuleBody.safeParse({ ...stop, scope: "leg", trail: { trigger: "money", value: "600" } }).success).toBe(true); // no target to stay below
    expect(RuleBody.safeParse({ ...stop, scope: "strategy", trail: { trigger: "pct", value: "15" } }).success).toBe(false);
    expect(RuleBody.safeParse({ ...stop, trail: { trigger: "pct", value: "100" } }).success).toBe(false);
    expect(RuleBody.safeParse({ ...stop, trail: { trigger: "money", value: "0" } }).success).toBe(false);
    expect(RuleBody.safeParse({ ...stop, trail: { trigger: "money", value: "0.004" } }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "spot", trigger: "below", value: "70000", trail: { trigger: "pct", value: "15" } }).success).toBe(false);
  });
  it("the running trail is its own kind: a give-back in money or a percentage with no basis, judged before the target and booked as stopped", () => {
    expect(RuleBody.safeParse({ kind: "trail", trigger: "pct", value: "15" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "money", value: "2" }).success).toBe(true);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "pct", value: "100" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "money", value: "0.004" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "money", value: "0" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "multiple", value: "2" }).success).toBe(false);
    expect(RuleBody.safeParse({ kind: "trail", trigger: "pct", value: "15", trail: { trigger: "pct", value: "15" } }).success).toBe(false);
    expect(RulesBody.safeParse({ rules: [{ kind: "trail", trigger: "pct", value: "15" }, { kind: "trail", trigger: "money", value: "2" }] }).success).toBe(false); // one per strategy
    expect(ruleLevel({ kind: "trail", trigger: "pct", value: "15", basisUsd: undefined })).toBe("0"); // the route keeps the running trail's own level
    // the exit under the best: money as typed; a percentage of the best, never less than the minimum
    expect(REST_TRAIL_MIN_GIVE_USD).toBe(0.1);
    expect(restTrailFloorUsd(6, { trigger: "pct", value: "15" })).toBeCloseTo(5.1, 10);
    expect(restTrailFloorUsd(0.01, { trigger: "pct", value: "15" })).toBeCloseTo(-0.09, 10);
    expect(restTrailFloorUsd(-1, { trigger: "money", value: "2" })).toBe(-3);
    expect(RULE_KIND_LABELS.trail).toBe("Trail on the rest");
    expect(CLOSE_REASON_OF_KIND.trail).toBe("stopped");
    expect(RULE_KIND_ORDER.trail).toBeGreaterThan(RULE_KIND_ORDER.leg_stop);
    expect(RULE_KIND_ORDER.trail).toBeLessThan(RULE_KIND_ORDER.target);
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

describe("HC-TR-191 [SCHEMA] the batch preview (ADR-087)", () => {
  it("names every strategy's check and the batch's own reasons; the body takes 1 to 20 ids", async () => {
    const { LiveBatchPreview, LiveBatchPreviewBody } = await import("./strategies");
    expect(LiveBatchPreviewBody.safeParse({ ids: [], brokerId: "brk_delta" }).success).toBe(false);
    expect(LiveBatchPreviewBody.safeParse({ ids: ["strat_1"], brokerId: "brk_delta", accountId: "crd_1" }).success).toBe(true);
    expect(LiveBatchPreviewBody.safeParse({ ids: ["strat_1", "strat_1"], brokerId: "brk_delta" }).success).toBe(false); // each strategy once
    const item = { id: "strat_1", name: "A", paper: true, ok: false, reasons: ["Notional too large"], legs: [], notional: "0.00", debit: "0.00" };
    const whole = { items: [item], ok: false, reasons: ["Available USD 20 is below the premium these 2 trades pay together (24.00)"], notional: "24.00", debit: "24.00", available: "20", availableAsset: "USD", marginUsed: null, marginRequired: null, limits: { maxLegs: 10, maxNotionalUsd: 100000, markBandPct: 5 } };
    expect(LiveBatchPreview.parse(whole)).toEqual(whole);
    expect(LiveBatchPreview.safeParse({ ...whole, extra: 1 }).success).toBe(false);
  });
});

describe("HC-TR-236 profit steps (ADR-120)", () => {
  it("HC-TR-236 a step closes its share of a leg in whole lots: never none, never all, and nothing of a leg down to one lot", () => {
    expect(stepLots(100, "0.25")).toBe(25);
    expect(stepLots(75, "0.3333")).toBe(25);
    expect(stepLots(50, 0.5)).toBe(25);
    expect(stepLots(3, "0.25")).toBe(1); // 0.75 rounds to a lot
    expect(stepLots(10, "0.01")).toBe(1); // at least one
    expect(stepLots(2, "0.99")).toBe(1); // at least one left
    expect(stepLots(1, "0.5")).toBe(0);
    expect(stepLots(0, "0.5")).toBe(0);
  });

  it("HC-TR-236 how far the open lots are up is their gain over the premium they were opened for, for a credit and for a debit; null with no premium to speak of", () => {
    // sold 100 lots at 900 and at 1,100, now 675 and 825: 50 gained on 200 received
    expect(openProfitPct([{ side: "sell", lots: 100, entry: 900, mark: 675 }, { side: "sell", lots: 100, entry: 1100, mark: 825 }], 0.001)).toBeCloseTo(25, 9);
    // the same position against the trade: negative
    expect(openProfitPct([{ side: "sell", lots: 100, entry: 900, mark: 1350 }], 0.001)).toBeCloseTo(-50, 9);
    // bought 10 lots at 1,200, now 1,500: 3 gained on 12 paid
    expect(openProfitPct([{ side: "buy", lots: 10, entry: 1200, mark: 1500 }], 0.001)).toBeCloseTo(25, 9);
    // with wings the premium is the net: (900 - 300) x 100 x 0.001 = 60; gain (225 - 100) x 0.1 = 12.5
    expect(openProfitPct([{ side: "sell", lots: 100, entry: 900, mark: 675 }, { side: "buy", lots: 100, entry: 300, mark: 200 }], 0.001)).toBeCloseTo((12.5 / 60) * 100, 9);
    expect(openProfitPct([{ side: "sell", lots: 1, entry: 900, mark: 1 }, { side: "buy", lots: 1, entry: 900, mark: 1 }], 0.001)).toBeNull();
    expect(openProfitPct([], 0.001)).toBeNull();
    // legs that nearly cancel out: sold at 500 and bought at 498 nets two against 998, far under a twentieth of it,
    // so a one-dollar move is not "half the premium"
    const reversal = [{ side: "sell" as const, lots: 10, entry: 500, mark: 499 }, { side: "buy" as const, lots: 10, entry: 498, mark: 498 }];
    expect(openPremium(reversal, 0.001).net).toBeCloseTo(0.02, 9);
    expect(openPremium(reversal, 0.001).gross).toBeCloseTo(9.98, 9);
    expect(stepPremiumOk(reversal, 0.001)).toBe(false);
    expect(openProfitPct(reversal, 0.001)).toBeNull();
    // a winged strangle nets half of what its legs cost: fine; a premium under a cent is not
    expect(stepPremiumOk([{ side: "sell", lots: 100, entry: 900 }, { side: "buy", lots: 100, entry: 300 }], 0.001)).toBe(true);
    expect(stepPremiumOk([{ side: "sell", lots: 1, entry: 5 }], 0.001)).toBe(false);
    expect(STEP_MIN_NET_SHARE).toBe(0.05);
  });

  it("HC-TR-236 a step is a percentage with a share above 0 and below 1 and needs no basis; a set holds at most four, each at its own level, and never beside a target", () => {
    const step = (value: string, closeShare?: string) => ({ kind: "step", trigger: "pct", value, ...(closeShare === undefined ? {} : { closeShare }) });
    expect(RuleBody.safeParse(step("25", "0.25")).success).toBe(true);
    expect(ruleLevel(RuleBody.parse(step("25", "0.25")))).toBe("25");
    for (const bad of [step("25"), step("25", "1"), step("25", "1.5"), step("0.5", "0.5"), { ...step("25", "0.5"), trigger: "money" }, { kind: "stop", trigger: "money", value: "50", closeShare: "0.5" }]) expect(RuleBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const four = [step("20", "0.2"), step("40", "0.25"), step("60", "0.3333"), step("80", "0.5")];
    expect(RulesBody.safeParse({ rules: four }).success).toBe(true);
    expect(RulesBody.safeParse({ rules: [...four, step("90", "0.5")] }).success).toBe(false);
    expect(RulesBody.safeParse({ rules: [step("25", "0.25"), step("25.0", "0.5")] }).success).toBe(false);
    expect(RulesBody.safeParse({ rules: [step("25", "0.25"), { kind: "target", trigger: "money", value: "50" }] }).success).toBe(false);
    expect(RulesBody.safeParse({ rules: [step("25", "0.25"), { kind: "stop", trigger: "money", value: "50" }] }).success).toBe(true);
    expect([RULE_KIND_LABELS.step, RULE_TRIGGERS_OF.step, CLOSE_REASON_OF_KIND.step, RULE_KIND_ORDER.step < RULE_KIND_ORDER.target, LADDER_STEPS.max]).toEqual(["Profit step", ["pct"], "target", true, 4]);
  });
});

describe("HC-TR-240 the profit lock (ADR-121)", () => {
  it("HC-TR-240 a lock is judged after the protective kinds and before a step or a target, books the reason target, and is never armed through a body", () => {
    expect(RULE_KIND_ORDER.trail < RULE_KIND_ORDER.lock && RULE_KIND_ORDER.lock < RULE_KIND_ORDER.step && RULE_KIND_ORDER.step < RULE_KIND_ORDER.target).toBe(true);
    expect([RULE_KIND_LABELS.lock, RULE_TRIGGERS_OF.lock, CLOSE_REASON_OF_KIND.lock]).toEqual(["Profit lock", ["money"], "target"]);
    const typed = RuleBody.safeParse({ kind: "lock", trigger: "money", value: "37.44" });
    expect(typed.success).toBe(false);
    expect(JSON.stringify(typed.error?.issues)).toContain("a profit lock is armed by Autopilot");
    expect(ruleLevel({ kind: "lock", trigger: "money", value: "37.44", basisUsd: undefined })).toBe("37.44");
    // armed once the level has been reached: the engine then writes the profit it saw
    expect(isLockArmed({ kind: "lock", peakPnl: null })).toBe(false);
    expect(isLockArmed({ kind: "lock" })).toBe(false);
    expect(isLockArmed({ kind: "lock", peakPnl: "38.1" })).toBe(true);
    expect(isLockArmed({ kind: "target", peakPnl: "38.1" })).toBe(false);
  });
});

describe("HC-TR-244 a leg buy-back (ADR-123)", () => {
  it("HC-TR-244 a buy-back is a price on one named leg, exits that leg alone, books the reason target and is judged after the protective kinds", () => {
    expect([RULE_KIND_LABELS.leg_take, RULE_TRIGGERS_OF.leg_take, CLOSE_REASON_OF_KIND.leg_take]).toEqual(["Leg buy-back", ["price"], "target"]);
    expect(RULE_KIND_ORDER.leg_stop < RULE_KIND_ORDER.leg_take && RULE_KIND_ORDER.lock < RULE_KIND_ORDER.leg_take && RULE_KIND_ORDER.leg_take < RULE_KIND_ORDER.step).toBe(true);
    const ok = { kind: "leg_take", trigger: "price", value: "5", legId: "l1" };
    expect(RuleBody.safeParse(ok).success).toBe(true);
    expect(RuleBody.safeParse({ ...ok, scope: "leg" }).success).toBe(true);
    const why = (body: unknown) => JSON.stringify(RuleBody.safeParse(body).error?.issues ?? []);
    expect(why({ kind: "leg_take", trigger: "price", value: "5" })).toContain("a leg buy-back names its leg");
    expect(why({ ...ok, scope: "strategy" })).toContain("a leg buy-back exits its own leg alone");
    expect(why({ ...ok, trigger: "multiple" })).toContain("leg_take takes price");
    expect(why({ ...ok, value: "0" })).toContain("must be greater than zero");
    expect(why({ ...ok, trail: { trigger: "pct", value: "20" } })).toContain("only a target or a leg stop can trail");
    expect(why({ kind: "spot", trigger: "above", value: "5", scope: "leg" })).toContain("only a leg stop or a leg buy-back can exit one leg");
    expect(ruleLevel({ kind: "leg_take", trigger: "price", value: "5", basisUsd: undefined }, "421.67")).toBe("5");
    // one per leg, beside that leg's stop
    const stop = { kind: "leg_stop", trigger: "multiple", value: "3", legId: "l1" };
    expect(RulesBody.safeParse({ rules: [ok, stop, { ...ok, legId: "l2" }] }).success).toBe(true);
    expect(JSON.stringify(RulesBody.safeParse({ rules: [ok, { ...ok, value: "2" }] }).error?.issues)).toContain("one leg stop and one leg buy-back per leg");
  });
});

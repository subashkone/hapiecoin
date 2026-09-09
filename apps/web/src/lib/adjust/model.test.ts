import type { AnalyzeResult } from "@hapiecoin/pricing";
import type { StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { USD } from "@/lib/money";
import { VALUE_TODAY, addsZeroDte, afterLegs, beforeLegs, cashflow, combinedExpiries, effects, instrumentOf, isEmptyDraft, lotsAfterOf, newDraft, openCountAfter, overCap, pickOnDraft, removePick, setLotsAfter, setPickLots, setValuation, summarize, toBody, valuationMsOf } from "./model";

const EXP = "2026-09-25";
const LATER = "2026-10-30";
const leg = (over: Partial<ServerLeg> & Pick<ServerLeg, "id" | "side" | "strike" | "symbol">): ServerLeg => ({
  kind: "call",
  expiry: EXP,
  lots: 100,
  price: "1200",
  entryPrice: "1200",
  exitPrice: null,
  iv: 0.5,
  status: "open",
  isAdjustment: false,
  position: 0,
  openedAt: "2026-09-08T10:00:00Z",
  closedAt: null,
  orderId: null,
  ...over,
});
const CALL = leg({ id: "leg_c", side: "buy", strike: "80000", symbol: "C-BTC-80000-250926" });
const PUT = leg({ id: "leg_p", kind: "put", side: "sell", strike: "78000", symbol: "P-BTC-78000-250926", price: "900", entryPrice: "900" });
const OPEN = [CALL, PUT];
const marks: Record<string, string> = { "C-BTC-80000-250926": "1300", "P-BTC-78000-250926": "800", "C-BTC-82000-250926": "700", "C-BTC-82000-301026": "1500" };
const markOf = (s: string) => marks[s];
const pick = (over: Partial<Parameters<typeof pickOnDraft>[3]> = {}) => ({ kind: "call" as const, side: "sell" as const, strike: "82000", expiry: EXP, lots: 50, price: "700", iv: 0.48, ...over });
const result = (over: Partial<AnalyzeResult>): AnalyzeResult => ({ points: [], maxProfit: 100, maxLoss: -50, breakevens: [], netPremium: 0, pop: 0.4, greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }, expectedMove: 0, rewardRisk: 2, target: { price: 0, pnlExpiry: 0, pnlTarget: 0 }, targetMs: 0, daysToNearestExpiry: 1, atmIv: 0.5, valuationMs: null, ...over });

describe("HC-TR-150 lots after: steppers on open legs and picks", () => {
  it("setLotsAfter clamps to whole non-negative lots; picks stay at least one lot", () => {
    let d = newDraft("strat_1", 1);
    expect(lotsAfterOf(d, CALL)).toBe(100);
    d = setLotsAfter(d, CALL.id, 60.4);
    expect(lotsAfterOf(d, CALL)).toBe(60);
    d = setLotsAfter(d, CALL.id, -3);
    expect(lotsAfterOf(d, CALL)).toBe(0);
    d = pickOnDraft(d, OPEN, "BTC", pick());
    d = setPickLots(d, d.picks[0]!.id, 0);
    expect(d.picks[0]!.lots).toBe(1);
    d = setPickLots(d, d.picks[0]!.id, Number.NaN);
    expect(d.picks[0]!.lots).toBe(1);
    expect(removePick(d, d.picks[0]!.id).picks).toEqual([]);
    expect(setValuation(d, LATER).valuation).toBe(LATER);
  });

  it("effects: trim, close, add and new leg with their labels; an untouched draft is empty", () => {
    let d = newDraft("strat_1", 1);
    expect(isEmptyDraft(d, OPEN)).toBe(true);
    expect(effects(setLotsAfter(d, CALL.id, 100), OPEN)).toEqual([]);
    d = setLotsAfter(d, CALL.id, 60);
    d = setLotsAfter(d, PUT.id, 0);
    d = pickOnDraft(d, OPEN, "BTC", pick());
    const e = effects(d, OPEN);
    expect(e.map((x) => [x.kind, x.lots])).toEqual([
      ["trim", 40],
      ["close", 100],
      ["new", 50],
    ]);
    expect(e[0]!.label).toBe("TRIMS 80,000 C 25 Sep by 40");
    expect(e[1]!.label).toBe("CLOSES 78,000 P 25 Sep");
    expect(e[2]!.label).toBe("NEW LEG");
    const more = setLotsAfter(newDraft("strat_1", 1), CALL.id, 150);
    expect(effects(more, OPEN)[0]).toMatchObject({ kind: "add", lots: 50, label: "ADDS +50 to 80,000 C 25 Sep" });
    expect(instrumentOf({ kind: "future", strike: "", expiry: "PERP", symbol: "BTCUSD" })).toBe("BTCUSD perp");
  });
});

describe("HC-TR-150 netting a chain pick against the position", () => {
  it("on a contract not held it toggles: same side removes, the other side replaces", () => {
    let d = pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick());
    expect(d.picks).toHaveLength(1);
    expect(d.picks[0]).toMatchObject({ side: "sell", lots: 50, symbol: "C-BTC-82000-250926" });
    d = pickOnDraft(d, OPEN, "BTC", pick({ side: "buy", lots: 20 }));
    expect(d.picks).toHaveLength(1);
    expect(d.picks[0]).toMatchObject({ side: "buy", lots: 20 });
    d = pickOnDraft(d, OPEN, "BTC", pick({ side: "buy" }));
    expect(d.picks).toEqual([]);
  });

  it("the same side on a held contract adds lots; the opposite side trims, closes, then flips the remainder", () => {
    let d = pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick({ side: "buy", strike: "80000", lots: 25 }));
    expect(lotsAfterOf(d, CALL)).toBe(125);
    expect(d.picks).toEqual([]);
    d = pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick({ side: "sell", strike: "80000", lots: 30 }));
    expect(lotsAfterOf(d, CALL)).toBe(70);
    expect(effects(d, OPEN)[0]!.kind).toBe("trim");
    d = pickOnDraft(d, OPEN, "BTC", pick({ side: "sell", strike: "80000", lots: 70 }));
    expect(lotsAfterOf(d, CALL)).toBe(0);
    expect(effects(d, OPEN)[0]!.kind).toBe("close");
    d = pickOnDraft(d, OPEN, "BTC", pick({ side: "sell", strike: "80000", lots: 10 }));
    expect(lotsAfterOf(d, CALL)).toBe(0);
    expect(d.picks).toHaveLength(1);
    expect(d.picks[0]).toMatchObject({ side: "sell", lots: 10, symbol: "C-BTC-80000-250926" });
    expect(effects(d, OPEN).at(-1)).toMatchObject({ kind: "flip", legId: CALL.id, lots: 10, label: "FLIPS 80,000 C 25 Sep to sell +10" });
    // more of the same flips into the same pick
    d = pickOnDraft(d, OPEN, "BTC", pick({ side: "sell", strike: "80000", lots: 5 }));
    expect(d.picks[0]!.lots).toBe(15);
  });

  it("trims the largest held row first when a contract is held in several rows", () => {
    const small = leg({ ...CALL, id: "leg_c2", lots: 10, isAdjustment: true, position: 2 });
    const open = [CALL, small, PUT];
    const d = pickOnDraft(newDraft("s", 1), open, "BTC", pick({ side: "sell", strike: "80000", lots: 105 }));
    expect(lotsAfterOf(d, CALL)).toBe(0);
    expect(lotsAfterOf(d, small)).toBe(5);
    expect(d.picks).toEqual([]);
  });
});

describe("HC-TR-149 before / after legs, cashflow, cap and valuation date", () => {
  it("before keeps entries; after keeps kept lots at entry and prices added lots and picks at the mark", () => {
    let d = setLotsAfter(newDraft("s", 1), CALL.id, 150);
    d = setLotsAfter(d, PUT.id, 0);
    d = pickOnDraft(d, OPEN, "BTC", pick({ expiry: LATER }));
    expect(beforeLegs(OPEN, "BTC").map((l) => [l.id, l.lots, l.price])).toEqual([
      ["leg_c", 100, "1200"],
      ["leg_p", 100, "900"],
    ]);
    const after = afterLegs(d, OPEN, "BTC", markOf);
    expect(after.map((l) => [l.id, l.lots, l.price])).toEqual([
      ["leg_c", 100, "1200"],
      ["leg_c:add", 50, "1300"],
      [d.picks[0]!.id, 50, "1500"],
    ]);
    // without a quote the pick keeps the price it was picked at
    expect(afterLegs(d, OPEN, "BTC", () => undefined).at(-1)!.price).toBe("700");
    expect(openCountAfter(d, OPEN)).toBe(3);
    expect(overCap(d, OPEN)).toBe(false);
    const many = { ...d, picks: Array.from({ length: 9 }, (_, i) => ({ ...d.picks[0]!, id: `p${i}` })) };
    expect(overCap(many, OPEN)).toBe(true);
  });

  it("cashflow: closing a long receives, closing a short pays, adds pay for buys and receive for sells", () => {
    const size = "0.001";
    expect(cashflow(setLotsAfter(newDraft("s", 1), CALL.id, 60), OPEN, markOf, size)).toBeCloseTo(1300 * 40 * 0.001);
    expect(cashflow(setLotsAfter(newDraft("s", 1), PUT.id, 0), OPEN, markOf, size)).toBeCloseTo(-800 * 100 * 0.001);
    expect(cashflow(setLotsAfter(newDraft("s", 1), CALL.id, 150), OPEN, markOf, size)).toBeCloseTo(-1300 * 50 * 0.001);
    expect(cashflow(pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick()), OPEN, markOf, size)).toBeCloseTo(700 * 50 * 0.001);
    // no quote: the entry (or the pick price) stands in
    expect(cashflow(setLotsAfter(newDraft("s", 1), CALL.id, 0), OPEN, () => undefined, size)).toBeCloseTo(1200 * 100 * 0.001);
  });

  it("expiries of the combined position, the valuation instant and the 0-DTE flag", () => {
    let d = newDraft("s", 1);
    const now = Date.UTC(2026, 8, 20, 9);
    expect(combinedExpiries(d, OPEN)).toEqual([EXP]);
    expect(valuationMsOf(d, OPEN, "BTC", now)).toBe(Date.UTC(2026, 8, 25, 12));
    d = pickOnDraft(d, OPEN, "BTC", pick({ expiry: LATER }));
    expect(combinedExpiries(d, OPEN)).toEqual([EXP, LATER]);
    expect(valuationMsOf(d, OPEN, "BTC", now)).toBe(Date.UTC(2026, 9, 30, 12)); // latest by default
    expect(valuationMsOf(setValuation(d, EXP), OPEN, "BTC", now)).toBe(Date.UTC(2026, 8, 25, 12));
    expect(valuationMsOf(setValuation(d, VALUE_TODAY), OPEN, "BTC", now)).toBe(now);
    expect(valuationMsOf(setValuation(d, "2030-01-01"), OPEN, "BTC", now)).toBe(Date.UTC(2026, 9, 30, 12)); // unknown choice → latest
    expect(valuationMsOf(newDraft("s", 1), [leg({ ...CALL, kind: "future", expiry: "PERP", symbol: "BTCUSD" })], "XAUT", now)).toBeUndefined();
    const closed = setLotsAfter(setLotsAfter(newDraft("s", 1), CALL.id, 0), PUT.id, 0);
    expect(combinedExpiries(closed, OPEN)).toEqual([]);
    const today = Date.UTC(2026, 8, 25, 8);
    expect(addsZeroDte(pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick()), OPEN, today)).toBe(true);
    expect(addsZeroDte(pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick({ expiry: LATER })), OPEN, today)).toBe(false);
    expect(addsZeroDte(setLotsAfter(newDraft("s", 1), CALL.id, 120), OPEN, today)).toBe(true);
    expect(addsZeroDte(setLotsAfter(newDraft("s", 1), CALL.id, 20), OPEN, today)).toBe(false);
  });
});

describe("HC-TR-151 the API batch and the change summary", () => {
  it("toBody: trims and closes as changes at the mark, extra lots and picks as adds with expected marks", () => {
    let d = setLotsAfter(newDraft("s", 1), CALL.id, 60);
    d = setLotsAfter(d, PUT.id, 150);
    d = pickOnDraft(d, OPEN, "BTC", pick({ iv: undefined }));
    const body = toBody(d, OPEN, markOf, { idempotencyKey: "web-key-000001", reason: "  roll up  " });
    expect(body.changes).toEqual([{ legId: "leg_c", lotsAfter: 60, price: "1300" }]);
    expect(body.adds).toEqual([
      { kind: "put", side: "sell", strike: "78000", expiry: EXP, symbol: "P-BTC-78000-250926", lots: 50, price: "800", iv: 0.5 },
      { kind: "call", side: "sell", strike: "82000", expiry: EXP, symbol: "C-BTC-82000-250926", lots: 50, price: "700" },
    ]);
    expect(body.expected).toEqual({ "P-BTC-78000-250926": "800", "C-BTC-82000-250926": "700" });
    expect(body.idempotencyKey).toBe("web-key-000001");
    expect(body.reason).toBe("roll up");
    // no quote: the entry / pick price stands in and no band is sent for that symbol; a blank reason is omitted
    const plain = toBody(d, [{ ...CALL, iv: null }, PUT], () => undefined, { idempotencyKey: "web-key-000002", reason: "  " });
    expect(plain.changes[0]!.price).toBe("1200");
    expect(plain.expected).toEqual({});
    expect(plain.reason).toBeUndefined();
    const zero = toBody(pickOnDraft(newDraft("s", 1), OPEN, "BTC", pick()), OPEN, () => "0", { idempotencyKey: "web-key-000003" });
    expect(zero.expected).toEqual({});
  });

  it("summarize: worsens / improves / unlimited wording, cash, POP and the guard rails", () => {
    const flags = { zeroDte: false, overCap: false, staleMarks: false };
    const worse = summarize(result({ maxLoss: -50, pop: 0.4 }), result({ maxLoss: -120, pop: 0.1 }), -47.81, USD, flags);
    expect(worse.line).toBe("max loss worsens by $70.00 · you pay $47.81 · POP 40% → 10%");
    expect(worse.warnings).toEqual([]);
    const better = summarize(result({ maxLoss: -50 }), result({ maxLoss: -20, pop: Number.NaN }), 12, USD, flags);
    expect(better.line).toBe("max loss improves by $30.00 · you receive $12.00 · POP 40% → —");
    const unlimited = summarize(result({ maxLoss: -50 }), result({ maxLoss: Number.NEGATIVE_INFINITY }), 0, USD, { ...flags, zeroDte: true, overCap: true, staleMarks: true });
    expect(unlimited.line).toBe("max loss becomes unlimited · POP 40% → 40%");
    expect(unlimited.warnings).toEqual([
      "Unlimited loss introduced: the change leaves a naked short side",
      "Over the 10 open-leg cap: close or merge a leg first",
      "Adds a leg that settles today (0 DTE)",
      "Marks are more than a minute old: Review re-reads them",
    ]);
    const covered = summarize(result({ maxLoss: Number.NEGATIVE_INFINITY, pop: Number.NaN }), result({ maxLoss: -40, pop: Number.NaN }), 0, USD, flags);
    expect(covered.line).toBe("max loss now −$40.00, no longer unlimited");
    expect(summarize(result({}), result({}), 0, USD, flags).line).toBe("max loss unchanged · POP 40% → 40%");
    expect(summarize(null, result({}), -5, USD, flags).line).toBe("you pay $5.00");
    expect(summarize(null, null, 0, USD, flags)).toEqual({ line: "", warnings: [] });
  });
});

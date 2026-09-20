import type { AnalyzeResult } from "@hapiecoin/pricing";
import { payoffAtDate, payoffAtExpiry } from "@hapiecoin/pricing";
import type { StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { USD } from "@/lib/money";
import { toPricingLegs } from "@/lib/pricing/legs";
import { MAX_PLANS, VALUE_TODAY, addsZeroDte, afterLegs, beforeLegs, cashflow, combinedExpiries, effects, instrumentOf, isEmptyDraft, isoDaysFrom, loadPlan, lotsAfterOf, matchingPlan, newDraft, normaliseLotsAfter, openCountAfter, overCap, pickOnDraft, realisedLegs, planDraft, removePick, removePlan, savePlan, setLotsAfter, setPickLots, setValuation, summarize, toBody, valuationMsOf } from "./model";

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
  it("HC-TR-195 (ADR-094) the lots a change takes off are priced as offsetting pairs worth exactly the locked-in result at every price, and never shown as legs", () => {
    // trim the long call 100 → 60 (bought 1,200, mark 1,300: +100 on 40 lots) and close the short put (sold 900, mark 800: +100 on 100 lots)
    let d = setLotsAfter(newDraft("s", 1), CALL.id, 60);
    d = setLotsAfter(d, PUT.id, 0);
    const pairs = realisedLegs(d, OPEN, "BTC", markOf);
    expect(pairs.map((l) => [l.id, l.side, l.lots, l.price])).toEqual([
      ["leg_c:held", "buy", 40, "1200"],
      ["leg_c:exit", "sell", 40, "1300"],
      ["leg_p:held", "sell", 100, "900"],
      ["leg_p:exit", "buy", 100, "800"],
    ]);
    const priced = toPricingLegs(pairs, "0.001", {});
    const locked = (1_300 - 1_200) * 40 * 0.001 + (900 - 800) * 100 * 0.001; // 4 + 10
    for (const price of [1, 60_000, 78_000, 80_000, 95_000, 200_000]) expect(payoffAtExpiry(priced, price)).toBeCloseTo(locked, 9);
    // and on any date before expiry, while both halves still carry time value: the two cancel there as well
    for (const at of [Date.UTC(2026, 8, 9), Date.UTC(2026, 8, 20)]) for (const price of [60_000, 79_000, 95_000]) expect(payoffAtDate(priced, price, at, 0, { defaultIv: 0.5 })).toBeCloseTo(locked, 9);
    // the legs the trader sees are untouched by it
    expect(afterLegs(d, OPEN, "BTC", markOf).map((l) => [l.id, l.lots])).toEqual([["leg_c", 60]]);
    // an add takes nothing off; a leg without a mark is assumed to exit at entry (as cashflow does), which locks in nothing
    expect(realisedLegs(setLotsAfter(newDraft("s", 1), CALL.id, 150), OPEN, "BTC", markOf)).toEqual([]);
    expect(realisedLegs(d, OPEN, "BTC", () => undefined)).toEqual([]);
  });

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
    expect(valuationMsOf(d, OPEN, "BTC", now)).toBe(Date.UTC(2026, 8, 25, 12)); // nearest by default (ADR-059): later legs keep time value
    expect(valuationMsOf(setValuation(d, LATER), OPEN, "BTC", now)).toBe(Date.UTC(2026, 9, 30, 12));
    expect(valuationMsOf(setValuation(d, VALUE_TODAY), OPEN, "BTC", now)).toBe(now);
    expect(valuationMsOf(setValuation(d, "2026-10-10"), OPEN, "BTC", now)).toBe(Date.UTC(2026, 9, 10, 12)); // a scenario date between the expiries
    expect(valuationMsOf(setValuation(d, "2026-02-30"), OPEN, "BTC", now)).toBe(Date.UTC(2026, 8, 25, 12)); // an impossible date → nearest
    expect(valuationMsOf(setValuation(d, "soon"), OPEN, "BTC", now)).toBe(Date.UTC(2026, 8, 25, 12)); // not a date → nearest
    expect(isoDaysFrom(now, 5)).toBe("2026-09-25");
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
    expect(body.orderType).toBe("market");
    expect(toBody(d, OPEN, markOf, { idempotencyKey: "web-key-000009", orderType: "limit" }).orderType).toBe("limit");
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

describe("lots after is only kept while it is an order", () => {
  it("normaliseLotsAfter drops entries equal to lots now and entries for legs no longer open, and keeps the rest", () => {
    const d = setLotsAfter(setLotsAfter(newDraft("s", 1), CALL.id, CALL.lots), PUT.id, 40);
    const n = normaliseLotsAfter({ ...d, lotsAfter: { ...d.lotsAfter, leg_gone: 5 } }, OPEN);
    expect(n.lotsAfter).toEqual({ [PUT.id]: 40 });
    expect(normaliseLotsAfter(n, OPEN)).toBe(n); // nothing to drop: the same object
    expect(normaliseLotsAfter(newDraft("s", 1), OPEN).lotsAfter).toEqual({});
  });
});

describe("HC-TR-153 plans: save up to three, load one back, remove", () => {
  it("names plans A, B, C in order, copies the changes, loads and removes them, and refuses a fourth", () => {
    let d = setLotsAfter(newDraft("s", 1), CALL.id, 60);
    expect(matchingPlan(d, OPEN)).toBeUndefined();
    d = savePlan(d, 2);
    expect(d.plans.map((p) => p.name)).toEqual(["Plan A"]);
    expect(d.plans[0]).toMatchObject({ lotsAfter: { leg_c: 60 }, picks: [], valuation: null });
    // saving starts the next change from the position as it stands
    expect(d.lotsAfter).toEqual({});
    expect(d.picks).toEqual([]);
    expect(matchingPlan(d, OPEN)).toBeUndefined();
    d = pickOnDraft(d, OPEN, "BTC", pick());
    d = savePlan(setValuation(d, VALUE_TODAY), 3);
    d = savePlan(setLotsAfter(d, CALL.id, 0), 4);
    expect(d.plans.map((p) => p.name)).toEqual(["Plan A", "Plan B", "Plan C"]);
    expect(d.plans.length).toBe(MAX_PLANS);
    expect(savePlan(d, 5).plans).toHaveLength(MAX_PLANS);
    const loaded = loadPlan(d, d.plans[0]!.id);
    expect(loaded.lotsAfter).toEqual({ leg_c: 60 });
    expect(loaded.picks).toEqual([]);
    expect(loaded.valuation).toBeNull();
    expect(matchingPlan(loaded, OPEN)?.name).toBe("Plan A"); // the working change is now a copy of Plan A
    expect(matchingPlan(setLotsAfter(loaded, CALL.id, 61), OPEN)).toBeUndefined();
    expect(matchingPlan(setLotsAfter(loaded, CALL.id, CALL.lots), OPEN)).toBeUndefined();
    expect(loadPlan(d, "plan_nope")).toBe(d);
    expect(planDraft(d, d.plans[1]!).picks).toHaveLength(1);
    expect(removePlan(d, d.plans[1]!.id).plans.map((p) => p.name)).toEqual(["Plan A", "Plan C"]);
    // saving after a removal reuses the free letter
    expect(savePlan(removePlan(d, d.plans[1]!.id), 6).plans.map((p) => p.name)).toEqual(["Plan A", "Plan C", "Plan B"]);
  });
});

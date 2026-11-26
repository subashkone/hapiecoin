// One Autopilot trade replayed over a hand-made price path (ADR-144; HC-TR-286): each exit on its own, to the cent.
// A sold strangle of 100 lots at 0.001 a lot: one dollar on a mark is ten cents on the trade.
import type { FeeRule } from "@hapiecoin/pricing";
import { CLOSE_REASON_OF_KIND } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import type { AutopilotPlan } from "./autopilot.js";
import { type SimBar, type SimInput, type SimLeg, simulateTrade } from "./clock-sim.js";

const FEES: FeeRule = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
const ENTRY = Date.UTC(2026, 7, 9, 16, 5); // 9 Aug 2026, 16:05 UTC
const SETTLE = Date.UTC(2026, 7, 10, 12, 0);
const MIN = 60_000;
const put: SimLeg = { kind: "put", side: "sell", strike: 98_000, lots: 100, price: 100 };
const call: SimLeg = { kind: "call", side: "sell", strike: 102_000, lots: 100, price: 120 };
const plan = (over: Partial<AutopilotPlan> = {}): AutopilotPlan => ({ fees: 0, targetUsd: null, stopUsd: null, timeStopDte: null, legStop: null, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, legBuyBackAt: null, legBuyBackShare: null, takeTrailPct: null, ...over });
/** Bars five minutes apart from the entry: the marks of each leg, in order. */
const bars = (...rows: (number | null)[][]): SimBar[] => rows.map((marks, i) => ({ ts: ENTRY + (i + 1) * 5 * MIN, marks, spot: 100_000 }));
const run = (over: Partial<SimInput> = {}) => simulateTrade({ legs: [put, call], plan: plan(), unitsPerLot: 0.001, feeRule: null, entryMs: ENTRY, entrySpot: 100_000, settleMs: SETTLE, settleSpot: 100_000, bars: [], ...over });
const kinds = (r: ReturnType<typeof run>) => r.events.map((e) => e.kind);

describe("HC-TR-286 a trade replayed over recorded prices", () => {
  it("HC-TR-286 with no exit it is held to the expiry and settles at its intrinsic value; the fees are the exchange's on each fill and on a settlement in the money", () => {
    const worthless = run({ feeRule: FEES, bars: bars([90, 110], [10, 5]) });
    expect(worthless.gross).toBeCloseTo(22, 9);
    // each entry fill: 0.01 % of the spot notional (1.00) capped at 3.5 % of the premium (0.35 and 0.42), plus 18 %
    expect(worthless.fees).toBeCloseTo((0.35 + 0.42) * 1.18, 9);
    expect(worthless.net).toBeCloseTo(22 - (0.35 + 0.42) * 1.18, 9);
    expect(worthless).toMatchObject({ reason: "expired", closedMs: SETTLE, barsJudged: 2, barsSkipped: 0 });
    expect(worthless.events).toEqual([{ ts: SETTLE, kind: "settled", closed: [{ leg: 0, lots: 100, price: 0 }, { leg: 1, lots: 100, price: 0 }], pnl: worthless.gross }]);
    // the call settles 1,000 in the money: 88 lost on it, 10 kept on the put, and the taker fee again on its value
    const inTheMoney = run({ feeRule: FEES, settleSpot: 103_000 });
    expect(inTheMoney.gross).toBeCloseTo(10 - 88, 9);
    expect(inTheMoney.fees).toBeCloseTo((0.35 + 0.42 + 1.03) * 1.18, 9);
    expect(inTheMoney.events[0]!.closed).toEqual([{ leg: 0, lots: 100, price: 0 }, { leg: 1, lots: 100, price: 1000 }]);
    // a put in the money, and no fee rule at all
    const putIn = run({ settleSpot: 97_500 });
    expect([putIn.gross, putIn.fees, putIn.net]).toEqual([expect.closeTo(-40 + 12, 9), 0, expect.closeTo(-28, 9)]);
  });

  it("HC-TR-286 a leg stop closes that sold option alone on the first bar at its multiple; the other is kept", () => {
    const r = run({ plan: plan({ legStop: 2 }), feeRule: FEES, bars: bars([90, 239.99], [80, 241], [70, 500]) });
    expect(kinds(r)).toEqual(["leg_stop", "settled"]);
    expect(r.events[0]).toMatchObject({ ts: ENTRY + 10 * MIN, closed: [{ leg: 1, lots: 100, price: 241 }] });
    // the call cost 12.10, the put still open was up 2.00 at that bar; then the put expires worthless
    expect(r.events[0]!.pnl).toBeCloseTo(-12.1 + 2, 9);
    expect(r.gross).toBeCloseTo(-12.1 + 10, 9);
    expect(r.reason).toBe("expired");
    // the exit fill pays its fee too: the notional cap is 1.00, 3.5 % of 24.10 is less
    expect(r.fees).toBeCloseTo((0.35 + 0.42 + 24.1 * 0.035) * 1.18, 9);
  });

  it("HC-TR-286 after a stop the rest is trailed from the realised total: it starts a cent in profit and closes on the give-back", () => {
    const r = run({ plan: plan({ legStop: 2, trailRestPct: 50 }), bars: bars([80, 241], [60, 300], [85, 300], [10, 300]) });
    expect(kinds(r)).toEqual(["leg_stop", "trail"]);
    // the put stood 2.00 up when the call was stopped, 4.00 at its best (exit level 2.00), then fell back to 1.50
    expect(r.events[1]).toMatchObject({ ts: ENTRY + 15 * MIN, closed: [{ leg: 0, lots: 100, price: 85 }] });
    expect(r.gross).toBeCloseTo(-12.1 + 1.5, 9);
    expect(r.reason).toBe(CLOSE_REASON_OF_KIND.trail);
    // a small best: the give-back is never under ten cents, so a best of 0.15 exits at 0.05, not at half of it
    const small = run({ plan: plan({ legStop: 2, trailRestPct: 50 }), bars: bars([100, 241], [98.5, 300], [99.3, 300], [99.6, 300]) });
    expect(small.events.map((e) => [e.kind, e.ts])).toEqual([["leg_stop", ENTRY + 5 * MIN], ["trail", ENTRY + 20 * MIN]]);
    expect(small.gross).toBeCloseTo(-12.1 + 0.04, 9);
    // the rest never in profit: no trail starts, and it runs to the expiry
    const flat = run({ plan: plan({ legStop: 2, trailRestPct: 50 }), bars: bars([100, 241], [130, 300]) });
    expect(kinds(flat)).toEqual(["leg_stop", "settled"]);
    // with wings, a second stop does not start a second trail beside the one running: the first one, which counts from
    // the total when the call was stopped, sees the put's loss as a fall of the rest and closes the wing on that bar
    const wing: SimLeg = { kind: "call", side: "buy", strike: 104_000, lots: 100, price: 20 };
    const two = run({ legs: [put, call, wing], plan: plan({ legStop: 2, trailRestPct: 50 }), bars: bars([90, 241, 60], [200, 241, 60], [200, 241, 61]) });
    expect(two.events.map((e) => [e.kind, e.ts, e.closed.map((c) => c.leg)])).toEqual([["leg_stop", ENTRY + 5 * MIN, [1]], ["leg_stop", ENTRY + 10 * MIN, [0]], ["trail", ENTRY + 10 * MIN, [2]]]);
    expect(two.gross).toBeCloseTo(-12.1 - 10 + 4, 9);
  });

  it("HC-TR-286 a profit take closes the whole trade at its share of the premium; with a trail it starts there and closes on the give-back from the best", () => {
    const take = run({ plan: plan({ targetUsd: 11 }), bars: bars([60, 61], [50, 60], [1, 1]) });
    expect(kinds(take)).toEqual(["target"]);
    expect(take).toMatchObject({ reason: "target", closedMs: ENTRY + 10 * MIN, barsJudged: 2 });
    expect(take.gross).toBeCloseTo(11, 9);
    const trail = run({ plan: plan({ targetUsd: 11, takeTrailPct: 20 }), bars: bars([50, 60], [40, 30], [50, 50], [1, 1]) });
    // 11.00 starts it (exit level 8.80), 15.00 is the best (12.00), and 12.00 is the fall to it
    expect(trail.events).toEqual([{ ts: ENTRY + 15 * MIN, kind: "target", closed: [{ leg: 0, lots: 100, price: 50 }, { leg: 1, lots: 100, price: 50 }], pnl: expect.closeTo(12, 9) as number }]);
    // the best is kept in whole cents rounded down: 15.004 is a best of 15.00 (exit level 12.00), so 12.002 is not yet the fall
    const fine = run({ plan: plan({ targetUsd: 11, takeTrailPct: 20 }), bars: bars([30, 39.96], [50, 49.98], [50, 50]) });
    expect(fine.events.map((e) => [e.kind, e.ts])).toEqual([["target", ENTRY + 15 * MIN]]);
    // below the level nothing trails
    expect(kinds(run({ plan: plan({ targetUsd: 11, takeTrailPct: 20 }), bars: bars([60, 61], [200, 200]) }))).toEqual(["settled"]);
  });

  it("HC-TR-286 profit in steps: an equal part of every leg at each level of the open lots' premium, the last part held", () => {
    const r = run({ plan: plan({ ladder: [25, 50] }), bars: bars([75, 90], [50, 60], [50, 60]) });
    expect(r.events.map((e) => [e.kind, e.closed.map((c) => c.lots)])).toEqual([["step", [33, 33]], ["step", [34, 34]], ["settled", [33, 33]]]);
    // a third at 25 %, half of the rest at 50 %, the last third to the expiry; each close of each leg booked in cents
    // (0.83 + 0.99, then 1.70 + 2.04, then 3.30 + 3.96)
    expect(r.gross).toBeCloseTo(0.83 + 0.99 + 1.7 + 2.04 + 3.3 + 3.96, 9);
    expect(r.reason).toBe("expired");
    // two levels crossed on one bar go in the order of the ladder, on that bar
    const both = run({ plan: plan({ ladder: [25, 50] }), bars: bars([50, 60]) });
    expect(both.events.map((e) => [e.ts, e.closed.map((c) => c.lots)])).toEqual([[ENTRY + 5 * MIN, [33, 33]], [ENTRY + 5 * MIN, [34, 34]], [SETTLE, [33, 33]]]);
    // a leg down to one lot keeps it while the other gives its share; the sold leg goes first whatever the order of the legs
    const uneven = run({ legs: [{ ...put, lots: 1 }, call], plan: plan({ ladder: [25] }), bars: bars([50, 60]) });
    expect(uneven.events[0]).toMatchObject({ kind: "step", closed: [{ leg: 1, lots: 50, price: 60 }] });
    const wingFirst = run({ legs: [{ kind: "put", side: "buy", strike: 96_000, lots: 100, price: 20 }, put, call], plan: plan({ targetUsd: 5 }), bars: bars([10, 50, 60]) });
    expect(wingFirst.events[0]!.closed.map((c) => c.leg)).toEqual([1, 2, 0]);
    // one lot cannot be split: the step is void; a net premium too thin to take a share of is not judged
    expect(kinds(run({ legs: [{ ...put, lots: 1 }, { ...call, lots: 1 }], plan: plan({ ladder: [25] }), bars: bars([1, 1]) }))).toEqual(["settled"]);
    const thin: SimLeg[] = [{ ...put, price: 500 }, { kind: "call", side: "buy", strike: 102_000, lots: 100, price: 498 }];
    expect(kinds(run({ legs: thin, plan: plan({ ladder: [25] }), bars: bars([400, 700]) }))).toEqual(["settled"]);
  });

  it("HC-TR-286 a profit lock arms at its level and closes the trade if the profit falls back to its floor; never armed, it does nothing", () => {
    const r = run({ plan: plan({ lock: { atUsd: 11, floorUsd: 4.4 } }), bars: bars([50, 60], [40, 50], [90, 90], [1, 1]) });
    expect(r.events).toEqual([{ ts: ENTRY + 15 * MIN, kind: "lock", closed: [{ leg: 0, lots: 100, price: 90 }, { leg: 1, lots: 100, price: 90 }], pnl: expect.closeTo(4, 9) as number }]);
    expect(r.reason).toBe(CLOSE_REASON_OF_KIND.lock);
    expect(kinds(run({ plan: plan({ lock: { atUsd: 11, floorUsd: 4.4 } }), bars: bars([90, 90], [300, 300]) }))).toEqual(["settled"]);
  });

  it("HC-TR-286 a timed exit closes everything on the first bar at or after its hour, the next day when the hour has passed", () => {
    const at = (h: number, m: number) => ({ ts: Date.UTC(2026, 7, 10, h, m), marks: [70, 80], spot: null });
    const r = run({ plan: plan({ exitHourUtc: 10 }), feeRule: FEES, bars: [{ ts: Date.UTC(2026, 7, 9, 23, 0), marks: [95, 95], spot: 100_000 }, at(9, 55), at(10, 0), at(10, 5)] });
    expect(r.events).toEqual([{ ts: Date.UTC(2026, 7, 10, 10, 0), kind: "time", closed: [{ leg: 0, lots: 100, price: 70 }, { leg: 1, lots: 100, price: 80 }], pnl: expect.closeTo(7, 9) as number }]);
    expect(r.reason).toBe("squared_off");
    // a bar with no spot: the entry's spot stands in for the fee's notional
    expect(r.fees).toBeCloseTo((0.35 + 0.42 + 7 * 0.035 + 8 * 0.035) * 1.18, 9);
    // an option dear enough for the notional to set the fee: 0.01 % of the bar's spot (0.90 at 90,000), or of the entry's (1.00) when the bar has none
    const dear = (spot: number | null) => run({ plan: plan({ exitHourUtc: 10 }), feeRule: FEES, bars: [{ ts: Date.UTC(2026, 7, 10, 10, 0), marks: [400, 80], spot }] }).fees;
    expect(dear(90_000)).toBeCloseTo((0.35 + 0.42 + 0.9 + 8 * 0.035) * 1.18, 9);
    expect(dear(null)).toBeCloseTo((0.35 + 0.42 + 1 + 8 * 0.035) * 1.18, 9);
  });

  it("HC-TR-286 a buy-back closes a sold option alone once its mark has fallen to the price or to the share of what it was sold for", () => {
    const byPrice = run({ plan: plan({ legBuyBackAt: 5 }), bars: bars([5.01, 60], [5, 60], [3, 0], [3, 4]) });
    // a mark of nothing is no price: the call waits for a real one
    expect(byPrice.events.map((e) => [e.kind, e.ts, e.closed])).toEqual([["leg_take", ENTRY + 10 * MIN, [{ leg: 0, lots: 100, price: 5 }]], ["leg_take", ENTRY + 20 * MIN, [{ leg: 1, lots: 100, price: 4 }]]]);
    expect(byPrice.gross).toBeCloseTo(9.5 + 11.6, 9);
    expect(byPrice.reason).toBe(CLOSE_REASON_OF_KIND.leg_take);
    // an option sold at or under the level has no buy-back: it would fire at once
    expect(kinds(run({ legs: [{ ...put, price: 5 }, call], plan: plan({ legBuyBackAt: 5 }), bars: bars([1, 60]) }))).toEqual(["settled"]);
    const byShare = run({ plan: plan({ legBuyBackShare: 0.2 }), bars: bars([20.01, 24.01], [20, 24.01]) });
    expect(byShare.events[0]).toMatchObject({ kind: "leg_take", closed: [{ leg: 0, lots: 100, price: 20 }] });
    // a share that rounds to nothing is no level
    expect(kinds(run({ legs: [{ ...put, price: 0.02 }, call], plan: plan({ legBuyBackShare: 0.2 }), bars: bars([0.001, 500]) }))).toEqual(["settled"]);
    // with a stop beside it: the stopped call's own buy-back is void, and a buy-back that ends such a trade ends it as stopped
    const after = run({ plan: plan({ legStop: 2, legBuyBackAt: 5 }), bars: bars([90, 241], [5, 1]) });
    expect(kinds(after)).toEqual(["leg_stop", "leg_take"]);
    expect(after.reason).toBe("stopped");
  });

  it("HC-TR-286 the exits on the whole trade of a bought spread: a target on the most it can make, a stop on the most it can lose, an exit so many days before the expiry", () => {
    const long: SimLeg = { kind: "call", side: "buy", strike: 100_000, lots: 10, price: 1000 };
    const short: SimLeg = { kind: "call", side: "sell", strike: 102_000, lots: 10, price: 400 };
    const far = ENTRY + 14 * 86_400_000;
    const day = (n: number, a: number, b: number): SimBar => ({ ts: ENTRY + n * 86_400_000, marks: [a, b], spot: 100_000 });
    const spread = (p: Partial<AutopilotPlan>, b: SimBar[]) => run({ legs: [long, short], plan: plan(p), settleMs: far, settleSpot: 101_000, bars: b });
    // 6.00 paid; up 3.00 is the stop
    const stopped = spread({ stopUsd: 3, targetUsd: 8 }, [day(1, 800, 350), day(2, 600, 300), day(3, 2000, 400)]);
    expect(stopped.events).toEqual([{ ts: ENTRY + 2 * 86_400_000, kind: "stop", closed: [{ leg: 1, lots: 10, price: 300 }, { leg: 0, lots: 10, price: 600 }], pnl: expect.closeTo(-3, 9) as number }]);
    expect(stopped.reason).toBe("stopped");
    const target = spread({ stopUsd: 3, targetUsd: 8 }, [day(1, 1900, 450)]);
    expect([target.reason, target.gross]).toEqual(["target", expect.closeTo(8.5, 9)]);
    // two days before the expiry, whatever the profit; before that nothing
    const timed = spread({ timeStopDte: 2 }, [day(11, 1100, 420), day(12, 1150, 430), day(13, 1, 1)]);
    expect(timed.events.map((e) => [e.kind, e.ts])).toEqual([["time", ENTRY + 12 * 86_400_000]]);
    expect(timed.reason).toBe("squared_off");
    // held to the expiry it settles 1,000 in the money on the bought call
    expect(spread({}, []).gross).toBeCloseTo((1000 - 1000) * 0.01 + 400 * 0.01, 9);
  });

  it("HC-TR-286 every close is booked in whole cents, as the paper book books it: a level on the total is judged on that total", () => {
    // the put is bought back at 4.97: 9.503 on paper is 9.50 in the book; the call then up 1.498 makes 10.998, not the 11.00 of the target
    const r = run({ plan: plan({ legBuyBackAt: 5, targetUsd: 11 }), bars: bars([4.97, 130], [4.97, 105.02], [4.97, 104.9]) });
    expect(r.events.map((e) => [e.kind, e.ts])).toEqual([["leg_take", ENTRY + 5 * MIN], ["target", ENTRY + 15 * MIN]]);
    expect(r.gross).toBe(9.5 + 1.51);
    // a settlement value is booked in cents too
    expect(run({ settleSpot: 102_000.004 }).events[0]!.closed[1]).toEqual({ leg: 1, lots: 100, price: 0 });
  });

  it("HC-TR-286 a bar in which an open leg has no mark is not judged, bars outside the trade are ignored, and a closed leg needs no mark", () => {
    const r = run({ plan: plan({ targetUsd: 11, legBuyBackAt: 5 }), bars: [{ ts: ENTRY, marks: [1, 1], spot: null }, ...bars([null, 1], [50, null], [5, 300], [null, 100], [null, 20]), { ts: SETTLE, marks: [1, 1], spot: null }] });
    // the first bar has no put mark, the second no call mark: both skipped; then the put is bought back and only the
    // call is read, on a bar where the closed put has no mark; the trade is over before the last bar
    expect(r.barsSkipped).toBe(2);
    expect(r.barsJudged).toBe(2);
    expect(r.events.map((e) => [e.kind, e.ts])).toEqual([["leg_take", ENTRY + 15 * MIN], ["target", ENTRY + 20 * MIN]]);
    expect(r.gross).toBeCloseTo(9.5 + 2, 9);
    // a bar at the settlement instant is the settlement's, not a bar to judge: marks that would take the profit are not read
    expect(kinds(run({ plan: plan({ targetUsd: 11 }), bars: [{ ts: SETTLE, marks: [1, 1], spot: null }] }))).toEqual(["settled"]);
    // a mark that is not a number above zero is a hole in the series, not a price
    const holes = run({ plan: plan({ targetUsd: 11 }), bars: bars([0, 1], [1, Number.NaN], [1, 1]) });
    expect([holes.barsSkipped, holes.barsJudged, holes.events[0]!.ts]).toEqual([2, 1, ENTRY + 15 * MIN]);
    expect(() => run({ legs: [] })).toThrow("A trade to replay has legs");
    expect(() => run({ legs: [{ ...put, lots: 0 }] })).toThrow("A trade to replay has legs");
  });
});

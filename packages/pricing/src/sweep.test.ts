// Bounded sweep (ADR-100; HC-TR-204): one trial per value, two axes row-major, the cap refuses a 9 × 6 grid, each axis
// lands on the right option, and the plateau reading tells a lone spike from a flat surface.
import { describe, expect, it } from "vitest";
import { type EodDay, type EodRow } from "./backtest.js";
import { calendarFor } from "./calendar.js";
import { SWEEP_MAX_TRIALS, SWEEP_MAX_VALUES, applyAxis, plateauOf, sweepBacktest, sweepShape } from "./sweep.js";
import { templateByName } from "./templates.js";

const cal = calendarFor(12);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const day = (n: number) => new Date(T0 + n * DAY).toISOString().slice(0, 10);
function ladder(spot: number, iv: number, strikes = [78_000, 79_000, 80_000, 81_000, 82_000]): EodRow[] {
  return strikes.map((strike) => ({ strike, call: { mark: Math.max(spot - strike, 0) + 500 * iv * 2, iv }, put: { mark: Math.max(strike - spot, 0) + 500 * iv * 2, iv: iv + 0.02 } }));
}
/** Ten days: an expiry on day 4 and one on day 9, the spot wandering. */
function days(): EodDay[] {
  const spots = [80_000, 80_400, 79_800, 81_000, 82_500, 82_000, 81_200, 82_800, 83_500, 83_000];
  return spots.map((spot, i) => ({ day: day(i), ts: T0 + i * DAY, spot, expiries: [{ expiry: day(4), rows: ladder(spot, 0.4 + i * 0.01) }, { expiry: day(9), rows: ladder(spot, 0.45 + i * 0.01) }] }));
}
const base = { lots: 10, unitsPerLot: 0.001, minDte: 1, calendar: cal };
const buyCall = templateByName("Buy Call")!;

describe("HC-TR-204 the bounded sweep", () => {
  it("runs one trial per value on one axis and lands the value on the right option", () => {
    const r = sweepBacktest(buyCall, days(), base, [{ axis: "minDte", values: [1, 3, 7] }]);
    expect(r.trials.map((t) => t.values)).toEqual([{ minDte: 1 }, { minDte: 3 }, { minDte: 7 }]);
    expect(r.cap).toBe(SWEEP_MAX_TRIALS);
    expect(r.trials[0]!.trades).toBeGreaterThan(r.trials[2]!.trades); // fewer days have an expiry a week out
    expect(applyAxis(base, "smaDays", 50)).toMatchObject({ conditions: { sma: { days: 50, side: "above" } } });
    expect(applyAxis({ ...base, conditions: { sma: { days: 20, side: "below" } } }, "smaDays", 50).conditions?.sma).toEqual({ days: 50, side: "below" });
    expect(applyAxis(base, "targetPct", 50).exits).toEqual({ targetPct: 0.5 });
    expect(applyAxis({ ...base, exits: { targetPct: 0.5 } }, "stopPct", 100).exits).toEqual({ targetPct: 0.5, stopPct: 1 });
    expect(applyAxis(base, "timeStopDte", 2).exits).toEqual({ timeStopDte: 2 });
    expect(applyAxis(base, "minDte", 7).minDte).toBe(7);
  });

  it("two axes run row-major, and the cap refuses a 9 × 6 grid, a repeated value and two equal axes", () => {
    const r = sweepBacktest(buyCall, days(), base, [
      { axis: "targetPct", values: [25, 50] },
      { axis: "minDte", values: [1, 3, 7] },
    ]);
    expect(r.trials).toHaveLength(6);
    expect(r.trials.map((t) => `${t.values.targetPct}/${t.values.minDte}`)).toEqual(["25/1", "25/3", "25/7", "50/1", "50/3", "50/7"]);
    expect(r.best).not.toBeNull();
    expect(r.trials[r.best!]!.total).toBe(Math.max(...r.trials.filter((t) => t.trades > 0).map((t) => t.total)));
    expect(sweepShape([{ axis: "minDte", values: [1, 2, 3, 4, 5, 6, 7, 8] }, { axis: "targetPct", values: [10, 20, 30, 40, 50, 60] }])).toEqual([8, 6]);
    expect(() => sweepShape([{ axis: "minDte", values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { axis: "targetPct", values: [10, 20, 30, 40, 50, 60] }])).toThrow(/at most 8 values/);
    expect(() => sweepShape([{ axis: "minDte", values: [1, 2, 3, 4, 5, 6, 7, 8] }, { axis: "targetPct", values: [10, 20, 30, 40, 50, 60, 70] }])).toThrow(/at most 6 values/);
    expect(() => sweepShape([{ axis: "minDte", values: [1, 1] }])).toThrow(/repeats/);
    expect(() => sweepShape([{ axis: "minDte", values: [3, 1] }])).toThrow(/must increase/);
    expect(() => sweepShape([{ axis: "minDte", values: [1] }, { axis: "minDte", values: [2] }])).toThrow(/must differ/);
    expect(() => sweepShape([])).toThrow(/one or two axes/);
    expect(() => sweepShape([{ axis: "minDte", values: [] }])).toThrow(/at least one value/);
    // the per-axis maxima are what bound the grid to the cap: a full 8 × 6 grid is exactly the cap, never over it
    expect(SWEEP_MAX_VALUES[0] * SWEEP_MAX_VALUES[1]).toBe(SWEEP_MAX_TRIALS);
  });

  it("the plateau of a lone spike is 0, of a flat surface 1, an edge cell counts only its neighbours, and a zero cell reads null", () => {
    expect(plateauOf([1, 10, 1], [3])).toEqual([1, 0, 1]); // the spike's neighbours keep nothing of it; each neighbour's only kept neighbour is the spike (same sign, far larger)
    expect(plateauOf([5, 5, 5, 5], [4])).toEqual([1, 1, 1, 1]);
    expect(plateauOf([0, 5], [2])).toEqual([null, 0]);
    expect(plateauOf([5], [1])).toEqual([null]);
    // a 2 × 2 grid: the corner at 10 has neighbours 6 (kept) and -4 (sign flips): one of two; the last 6 has 6 (kept) and -4
    expect(plateauOf([10, 6, -4, 6], [2, 2])).toEqual([0.5, 1, 0, 0.5]);
  });
});

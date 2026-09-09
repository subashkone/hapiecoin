import type { ChainRow } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { aroundAtm, atmIvOf, gridMax, heatAlpha, nearestIndex, pcrLabel, scenarioAxes, skew25, termShape, toPricingRows } from "./structure";

const q = (mark: string, over: Partial<NonNullable<ChainRow["call"]>> = {}): NonNullable<ChainRow["call"]> => ({ instrumentId: "1", ts: 0, mark, oi: "100", spot: "79521", ...over });
const rows: ChainRow[] = [
  { strike: "78000", call: q("2000", { markIv: 0.5, oi: "300", volume24h: "40", greeks: { delta: 0.7, gamma: 0.00002, theta: -20, vega: 90 } }), put: q("900", { markIv: 0.56, oi: "500", greeks: { delta: -0.3, gamma: 0.00002, theta: -20, vega: 90 } }) },
  { strike: "80000", call: q("1200", { markIv: 0.44, oi: "800", volume24h: "60", greeks: { delta: 0.45, gamma: 0.00003, theta: -20, vega: 90 } }), put: q("1500", { markIv: 0.46, oi: "700", greeks: { delta: -0.55, gamma: 0.00003, theta: -20, vega: 90 } }) },
  { strike: "82000", call: q("700", { markIv: 0.42, oi: "1200", volume24h: "20", greeks: { delta: 0.26, gamma: 0.00002, theta: -20, vega: 90 } }), put: q("2600", { markIv: 0.41, oi: "200", greeks: { delta: -0.74, gamma: 0.00002, theta: -20, vega: 90 } }) },
  { strike: "84000", call: q("350", { markIv: 0.47, oi: "900" }) },
];

describe("HC-WS-094 / HC-WS-098 chain rows → pricing rows and ATM figures", () => {
  it("maps decimal strings to numbers per side and leaves missing sides undefined", () => {
    const p = toPricingRows(rows);
    expect(p[0]).toEqual({ strike: 78000, callOi: 300, putOi: 500, callVolume: 40, putVolume: undefined, callIv: 0.5, putIv: 0.56, callGamma: 0.00002, putGamma: 0.00002 });
    expect(p[3]).toMatchObject({ strike: 84000, callOi: 900, putOi: undefined, putIv: undefined, putGamma: undefined });
    expect(toPricingRows([{ strike: "1", call: q("x", { oi: "nope" }) }])[0]!.callOi).toBeUndefined();
  });

  it("windows the rows around the ATM index and keeps every row when ATM is unknown", () => {
    expect(aroundAtm([1, 2, 3, 4, 5, 6, 7], 3, 1)).toEqual([3, 4, 5]);
    expect(aroundAtm([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(aroundAtm([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
  });

  it("ATM IV is the mean of both sides on the nearest strike; the 25Δ skew reads the quotes' own deltas", () => {
    expect(atmIvOf(rows, 79_600)).toBeCloseTo(0.45, 6);
    expect(atmIvOf(rows, 83_900)).toBe(0.47); // only a call quoted there
    expect(atmIvOf(rows, null)).toBeNull();
    expect(atmIvOf([], 1)).toBeNull();
    expect(atmIvOf([{ strike: "1" }], 1)).toBeNull();
    const s = skew25(rows)!;
    expect(s.call).toEqual({ strike: "82000", iv: 0.42 });
    expect(s.put).toEqual({ strike: "78000", iv: 0.56 });
    expect(s.skewPts).toBeCloseTo(14, 6);
    expect(skew25([{ strike: "1", call: q("1", { greeks: { delta: 0.25, gamma: 0, theta: 0, vega: 0 } }) }])).toBeNull(); // no IV, no put
    expect(skew25(rows.map((r) => ({ strike: r.strike, call: r.call ? { ...r.call, greeks: undefined } : undefined, put: r.put ? { ...r.put, greeks: undefined } : undefined })))).toBeNull(); // no deltas at all
  });
});

describe("HC-WS-088 scenario axes, target lookup and shading", () => {
  it("builds 11 price rows from +range to −range and six de-duplicated date columns ending at settlement", () => {
    const now = Date.UTC(2026, 8, 9, 10);
    const settle = Date.UTC(2026, 8, 25, 12);
    const ax = scenarioAxes(80_000, 10, 16, now, settle);
    expect(ax.pcts).toEqual([10, 8, 6, 4, 2, 0, -2, -4, -6, -8, -10]);
    expect(ax.prices[0]).toBe(88_000);
    expect(ax.prices[10]).toBe(72_000);
    expect(ax.days).toEqual([0, 4, 8, 12, 15, 16]);
    expect(ax.dates[0]).toBe(now);
    expect(ax.dates[5]).toBe(settle);
    expect(ax.dates[1]).toBe(now + 4 * 86_400_000);
    const wide = scenarioAxes(80_000, 20, 1, now);
    expect(wide.pcts[1]).toBe(16);
    expect(wide.days).toEqual([0, 1]); // ¼, ½, ¾ of one day collapse into today and expiry
    expect(wide.dates[1]).toBe(now + 86_400_000);
    expect(scenarioAxes(80_000, 10, 0, now).days).toEqual([0]);
  });

  it("finds the nearest index, shades by magnitude and finds the grid maximum", () => {
    expect(nearestIndex([88_000, 84_000, 80_000], 81_000)).toBe(2);
    expect(nearestIndex([1, 2, 3], 2.5)).toBe(1);
    expect(nearestIndex([], 1)).toBe(-1);
    expect(heatAlpha(0, 100)).toBeCloseTo(0.1);
    expect(heatAlpha(-100, 100)).toBeCloseTo(0.6);
    expect(heatAlpha(250, 100)).toBeCloseTo(0.6);
    expect(heatAlpha(Number.NaN, 100)).toBe(0.1);
    expect(heatAlpha(5, 0)).toBe(0.1);
    expect(gridMax([[1, -7], [Number.NaN, 3]])).toBe(7);
    expect(gridMax([[0, 0]])).toBe(1);
  });

  it("names the put / call read and the term-structure shape", () => {
    expect(pcrLabel(1.5)).toBe("put-heavy");
    expect(pcrLabel(0.5)).toBe("call-heavy");
    expect(pcrLabel(1)).toBe("balanced");
    expect(pcrLabel(null)).toBe("—");
    expect(pcrLabel(Number.POSITIVE_INFINITY)).toBe("—");
    expect(termShape([0.4, null, 0.5])).toBe("contango");
    expect(termShape([0.6, 0.5])).toBe("backwardation");
    expect(termShape([0.5, 0.503])).toBe("flat");
    expect(termShape([0.5])).toBeNull();
    expect(termShape([null, null])).toBeNull();
  });
});

describe("HC-WS-029, 074, 080 chain footer stats and the Δ finder", () => {
  it("chainStats: max pain, 25Δ skew and the ATM forward from put-call parity", async () => {
    const { chainStats, nearestDelta, DELTA_CHIPS } = await import("./structure");
    const st = chainStats(rows, 79521);
    expect(st.maxPain).not.toBeNull();
    expect(Number.isFinite(st.maxPain!)).toBe(true);
    expect(st.skewPts === null || Number.isFinite(st.skewPts)).toBe(true);
    // fwd = K + C − P at the strike nearest spot with both marks
    const atm = [...rows].filter((r) => r.call && r.put).sort((a, b) => Math.abs(Number(a.strike) - 79521) - Math.abs(Number(b.strike) - 79521))[0]!;
    expect(st.fwd).toBeCloseTo(Number(atm.strike) + Number(atm.call!.mark) - Number(atm.put!.mark), 6);
    expect(chainStats([], 79521)).toEqual({ maxPain: null, skewPts: null, fwd: null });
    expect(chainStats(rows, null).fwd).toBeNull();
    expect(DELTA_CHIPS).toEqual([10, 16, 25, 50]);
    const hit = nearestDelta(rows, 0.25);
    expect(hit.call && hit.put).toBeTruthy();
    expect(Math.abs(hit.call!.delta - 0.25)).toBeLessThan(0.15);
    expect(Math.abs(hit.put!.delta + 0.25)).toBeLessThan(0.15);
    expect(Number(hit.call!.strike)).toBeGreaterThan(Number(hit.put!.strike)); // OTM call above, OTM put below
    expect(nearestDelta(rows.map((r) => ({ strike: r.strike, call: r.call ? { ...r.call, greeks: undefined } : undefined, put: r.put ? { ...r.put, greeks: undefined } : undefined })), 0.25)).toEqual({ call: null, put: null });
  });
});

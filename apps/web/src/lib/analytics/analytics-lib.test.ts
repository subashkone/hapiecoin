// Analytics helpers (HC-MA-009, 011, 093): chart layout maths, timeframe slicing and the formatters.
import { describe, expect, it } from "vitest";
import { indexAt, layoutChart, niceTicks } from "./chart";
import { ago, fearGreedTone, heatAlpha, pct, price, signedUsdCompact, sliceSeries, toneClass, usdCompact } from "./format";

describe("formatters", () => {
  it("compacts USD, prices by magnitude, signed percents and tones", () => {
    expect(usdCompact(1.234e12)).toBe("$1.23T");
    expect(usdCompact(8.4e9)).toBe("$8.40B");
    expect(usdCompact(-2.5e6)).toBe("-$2.50M");
    expect(usdCompact(999)).toBe("$999.00");
    expect(usdCompact(null)).toBe("—");
    expect(signedUsdCompact(1500)).toBe("+$1.50K");
    expect(signedUsdCompact(-20)).toBe("-$20.00");
    expect(signedUsdCompact(undefined)).toBe("—");
    expect(price(80000)).toBe("$80,000.00");
    expect(price(150.5)).toBe("$150.50");
    expect(price(3.14159)).toBe("$3.142");
    expect(price(0.55)).toBe("$0.55");
    expect(price(0.0001234)).toBe("$0.0001234");
    expect(price(NaN)).toBe("—");
    expect(pct(1.234)).toBe("+1.23%");
    expect(pct(-0.5, 1)).toBe("-0.5%");
    expect(pct(0.0001, 2, true)).toBe("+0.01%");
    expect(pct(null)).toBe("—");
    expect(toneClass(1)).toBe("text-profit");
    expect(toneClass(-1)).toBe("text-loss");
    expect(toneClass(0)).toBe("text-muted-foreground");
    expect(toneClass(null)).toBe("text-muted-foreground");
    expect(heatAlpha(2.5, 5)).toBeCloseTo(0.175, 6);
    expect(heatAlpha(50, 5)).toBeCloseTo(0.35, 6);
    expect(heatAlpha(null)).toBe(0);
    expect([10, 30, 50, 60].map(fearGreedTone)).toEqual(["loss", "warning", "muted", "profit"]);
    const now = 10_000_000;
    expect(ago(now - 5_000, now)).toBe("5s ago");
    expect(ago(now - 120_000, now)).toBe("2m ago");
    expect(ago(now - 7_200_000, now)).toBe("2h ago");
    expect(ago(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
  it("slices a series to the timeframe, thins to 120 points and labels by span", () => {
    const now = Date.UTC(2026, 8, 9, 12, 0, 0);
    const pts = Array.from({ length: 2000 }, (_, i) => ({ t: now - (1999 - i) * 3_600_000, v: i }));
    const d1 = sliceSeries(pts, "1D", now);
    expect(d1.values).toHaveLength(25);
    expect(d1.covered).toBe(true);
    expect(d1.x[0]).toMatch(/^\d{2}:\d{2}$/);
    const y1 = sliceSeries(pts, "1Y", now);
    expect(y1.values).toHaveLength(120);
    expect(y1.covered).toBe(false); // 2000 h < 1 y
    expect(y1.x[0]).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    expect(y1.xTip[0]).toMatch(/\d{2}:\d{2}$/);
    const d30 = sliceSeries(pts, "30D", now);
    expect(d30.x[0]).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    expect(sliceSeries([], "7D", now)).toEqual({ values: [], x: [], xTip: [], covered: false });
  });
});

describe("chart layout", () => {
  it("makes nice ticks", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0.1, 0.9, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });
  it("lays out lines, areas, stacked bars, dual axes, tags and hlines, and skips gaps", () => {
    const l = layoutChart({ w: 400, h: 200, x: ["a", "b", "c", "d"], series: [{ label: "OI", type: "area", data: [1, 2, null, 4], color: "red" }, { label: "Px", type: "line", data: [10, 12, 11, 13], axis: "r", fmt: (v) => `$${v}` }], rightAxis: true, hlines: [{ y: 2, label: "two" }], yFmt: (v) => v.toFixed(0) });
    expect(l.paths.map((p) => p.key)).toEqual(["OI", "Px"]);
    expect(l.paths[0]?.d).toMatch(/^M.*L.*M/); // the gap restarts the path
    expect(l.paths[0]?.area).toContain("Z");
    expect(l.paths[1]?.area).toBeNull();
    expect(l.tags.map((t) => t.text)).toEqual(["4", "$13"]);
    expect(l.yr).not.toBeNull();
    expect(l.ticksL.length).toBeGreaterThan(1);
    expect(l.ticksR.length).toBeGreaterThan(1);
    expect(l.hlines[0]?.label).toBe("two");
    expect(l.xTicks[0]).toEqual({ i: 0, label: "a" });
    expect(l.sy(l.yl.lo)).toBeCloseTo(200 - l.pad.b, 6);
    expect(l.sy(l.yl.hi)).toBeCloseTo(l.pad.t, 6);
    const bars = layoutChart({ w: 300, h: 100, x: ["a", "b"], stack: true, tight: true, series: [{ label: "L", type: "bar", data: [60, 40] }, { label: "S", type: "bar", data: [40, 60] }, { label: "neg", type: "bar", data: [-10, null] }] });
    expect(bars.bars).toHaveLength(5);
    expect(bars.hasBars).toBe(true);
    expect(bars.yl.lo).toBe(-10);
    expect(bars.yl.hi).toBe(100);
    expect(bars.tags).toEqual([]);
    const grouped = layoutChart({ w: 300, h: 100, x: ["a"], series: [{ label: "A", type: "bar", data: [1] }, { label: "B", type: "bar", data: [2] }] });
    expect(grouped.bars.map((b) => b.x)).not.toEqual([grouped.bars[0]?.x, grouped.bars[0]?.x]);
    expect(indexAt(grouped, grouped.pad.l + 1)).toBe(0);
    expect(indexAt(l, 1e9)).toBe(3);
    expect(indexAt(l, -1e9)).toBe(0);
  });
  it("colours negative bars with colorNeg", () => {
    const l = layoutChart({ x: ["a", "b"], series: [{ label: "f", type: "bar", data: [1, -1], color: "up", colorNeg: "down" }] });
    expect(l.bars.map((b) => b.color)).toEqual(["up", "down"]);
  });
  it("handles hidden series, flat data, explicit min/max, zero and empty inputs", () => {
    const flat = layoutChart({ w: 200, h: 100, x: ["a", "b"], series: [{ label: "f", data: [5, 5] }] });
    expect(flat.yl.lo).toBeLessThan(5);
    expect(flat.yl.hi).toBeGreaterThan(5);
    const clamped = layoutChart({ w: 200, h: 100, x: ["a", "b"], series: [{ label: "f", data: [40, 60] }], min: 0, max: 100, zero: true });
    expect(clamped.yl).toEqual({ lo: 0, hi: 100 });
    expect(layoutChart({ w: 200, h: 70, x: ["a", "b"], series: [{ label: "f", data: [40, 60] }], min: 0, max: 100, yTicks: 1 }).ticksL).toEqual([0, 100]);
    const hidden = layoutChart({ w: 200, h: 100, x: ["a"], series: [{ label: "f", data: [1] }] }, new Set(["f"]));
    expect(hidden.paths).toEqual([]);
    expect(hidden.yl).toEqual({ lo: 0, hi: 1 });
    const empty = layoutChart({ x: [], series: [{ label: "e", data: [] }] });
    expect(empty.n).toBe(1);
    expect(empty.paths).toEqual([]);
    const allNull = layoutChart({ w: 200, h: 100, x: ["a", "b"], series: [{ label: "n", data: [null, null] }] });
    expect(allNull.paths).toEqual([]);
    const only = layoutChart({ w: 200, h: 100, x: ["a"], series: [{ label: "o", data: [3] }], hlines: [{ y: 1, axis: "r" }], rightAxis: true });
    expect(only.yr?.lo).toBeLessThanOrEqual(1);
    const single = layoutChart({ w: 200, h: 100, x: ["a"], series: [{ label: "s", type: "line", data: [2] }] });
    expect(single.sx(0)).toBeCloseTo(single.pad.l + (200 - single.pad.l - single.pad.r) / 2, 6);
  });
});

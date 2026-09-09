import { describe, expect, it } from "vitest";
import { type HeatFrame, drawHeat, hslTokenToRgb, sampleGrid } from "./heatDraw";

function fakeCtx(withBuffer: boolean) {
  const calls: string[] = [];
  const buffer = new Uint8ClampedArray(4 * 4 * 4);
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_, prop) => {
      if (typeof prop !== "string") return undefined;
      if (prop === "createImageData") return () => (withBuffer ? { data: buffer, width: 4, height: 4 } : undefined);
      return (...args: unknown[]) => {
        calls.push(`${prop}${args.length ? `(${args.map((a) => (typeof a === "number" ? a.toFixed(1) : String(a))).join(",")})` : ""}`);
        return undefined;
      };
    },
    set: (_, prop, value) => {
      calls.push(`${String(prop)}=${String(value)}`);
      return true;
    },
  });
  return { ctx, calls, buffer };
}

const colors: HeatFrame["colors"] = { profit: [0, 200, 0], loss: [200, 0, 0], background: [10, 10, 10], foreground: [230, 230, 230], spot: [240, 160, 0] };

describe("HC-WS-092 smooth heat field", () => {
  it("converts the theme's hsl tokens to rgb", () => {
    expect(hslTokenToRgb("0 100% 50%")).toEqual([255, 0, 0]);
    expect(hslTokenToRgb("120 100% 50%")).toEqual([0, 255, 0]);
    expect(hslTokenToRgb("240 100% 50%")).toEqual([0, 0, 255]);
    expect(hslTokenToRgb("60 100% 50%")).toEqual([255, 255, 0]);
    expect(hslTokenToRgb("180 100% 50%")).toEqual([0, 255, 255]);
    expect(hslTokenToRgb("300 100% 50%")).toEqual([255, 0, 255]);
    expect(hslTokenToRgb("0 0% 50%")).toEqual([128, 128, 128]);
    expect(hslTokenToRgb("nope")).toEqual([128, 128, 128]);
    expect(hslTokenToRgb("")).toEqual([128, 128, 128]);
  });

  it("samples the grid bilinearly, clamps outside the cells and treats NaN as zero", () => {
    const cells = [
      [0, 10],
      [20, Number.NaN],
    ];
    expect(sampleGrid(cells, 0, 0)).toBe(0);
    expect(sampleGrid(cells, 0, 1)).toBe(10);
    expect(sampleGrid(cells, 1, 0)).toBe(20);
    expect(sampleGrid(cells, 0, 0.5)).toBe(5);
    expect(sampleGrid(cells, 0.5, 0)).toBe(10);
    expect(sampleGrid(cells, 0.5, 0.5)).toBe(7.5); // the NaN corner counts as zero
    expect(sampleGrid(cells, -3, 9)).toBe(10);
    expect(sampleGrid([], 0, 0)).toBe(0);
    expect(sampleGrid([[]], 0, 0)).toBe(0);
  });

  it("paints the field toward the background by magnitude, then the separators, the ridge, the spot row and the target", () => {
    const { ctx, calls, buffer } = fakeCtx(true);
    const cells = [
      [100, -100],
      [-50, 50],
    ];
    drawHeat(ctx, { width: 4, height: 4, cells, vmax: 100, colors, target: { i: 1, j: 0 }, spotRow: 0 });
    // the top-left pixel sits on a strong profit cell: greener than the background
    expect(buffer[1]!).toBeGreaterThan(buffer[0]!);
    expect(buffer[3]).toBe(255);
    expect(calls.some((c) => c.startsWith("putImageData"))).toBe(true);
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThanOrEqual(3); // one separator + two sign changes
    expect(calls.some((c) => c.startsWith("fillRect(0.0"))).toBe(true); // spot hairline
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(true); // target outline
    expect(calls).toContain("setLineDash(3,3)");
  });

  it("does nothing without a pixel buffer, an empty grid or a tiny canvas", () => {
    const empty = fakeCtx(false);
    drawHeat(empty.ctx, { width: 4, height: 4, cells: [[1, 2]], vmax: 2, colors, target: null, spotRow: null });
    expect(empty.calls.some((c) => c.startsWith("putImageData"))).toBe(false);
    const tiny = fakeCtx(true);
    drawHeat(tiny.ctx, { width: 1, height: 1, cells: [[1]], vmax: 1, colors, target: null, spotRow: null });
    drawHeat(tiny.ctx, { width: 4, height: 4, cells: [], vmax: 1, colors, target: null, spotRow: null });
    expect(tiny.calls).toEqual([]);
    const flat = fakeCtx(true);
    drawHeat(flat.ctx, { width: 4, height: 4, cells: [[Number.NaN, 0]], vmax: 0, colors, target: null, spotRow: null });
    expect(flat.calls.filter((c) => c === "stroke").length).toBe(1); // one separator, no ridge
  });
});

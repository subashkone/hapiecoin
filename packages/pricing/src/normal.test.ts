import { describe, expect, it } from "vitest";
import { erf, erfc, normalCdf, normalPdf } from "./normal.js";

/** Independent reference: Maclaurin series, accurate to ~1e-13 for |x| <= 3. */
function erfSeries(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 400; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-18 * Math.abs(sum)) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

/** Independent reference: Laplace continued fraction for erfc(x), x >= 2. */
function erfcContinuedFraction(x: number): number {
  let f = x;
  for (let k = 120; k >= 1; k--) f = x + k / 2 / f;
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

function erfReference(x: number): number {
  const y = Math.abs(x);
  const r = y <= 2.5 ? erfSeries(y) : 1 - erfcContinuedFraction(y);
  return x < 0 ? -r : r;
}

describe("[PRICING] erf / erfc (Cody rational approximation)", () => {
  it("[PRICING] matches an independent series / continued-fraction reference to better than 1e-12 on [-6, 6]", () => {
    let maxErr = 0;
    for (let i = 0; i <= 2400; i++) {
      const x = -6 + i * 0.005;
      const err = Math.abs(erf(x) - erfReference(x));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1e-12);
    process.stdout.write(`[PRICING] erf max abs error vs reference on [-6, 6] (2401 points): ${maxErr.toExponential(2)}\n`);
  });

  it("[PRICING] the two reference methods agree where they overlap", () => {
    for (const x of [2, 2.25, 2.5, 2.75, 3]) {
      expect(Math.abs(erfSeries(x) - (1 - erfcContinuedFraction(x)))).toBeLessThan(1e-11);
    }
  });

  it("[PRICING] erfc keeps relative accuracy deep in the tail", () => {
    for (let x = 2; x < 26; x += 0.5) {
      const ref = erfcContinuedFraction(x);
      expect(Math.abs(erfc(x) / ref - 1)).toBeLessThan(1e-10);
      expect(erfc(-x)).toBeCloseTo(2 - ref, 12);
    }
    expect(erfc(27)).toBe(0);
    expect(erfc(-27)).toBe(2);
  });

  it("[PRICING] reproduces tabulated values and symmetry", () => {
    expect(erf(0)).toBe(0);
    expect(erf(0.5)).toBeCloseTo(0.5204998778130465, 14);
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 14);
    expect(erf(2)).toBeCloseTo(0.9953222650189527, 14);
    expect(erf(-1)).toBeCloseTo(-0.8427007929497149, 14);
    expect(erf(Infinity)).toBe(1);
    expect(erf(-Infinity)).toBe(-1);
    expect(erfc(0)).toBe(1);
    expect(erfc(0.3)).toBeCloseTo(1 - erf(0.3), 15);
    for (const x of [0.1, 0.4, 0.7, 1.3, 3.9, 4.1, 7]) expect(erf(-x)).toBe(-erf(x));
    expect(erf(NaN)).toBeNaN();
    expect(erfc(NaN)).toBeNaN();
  });
});

describe("[PRICING] normal distribution", () => {
  it("[PRICING] normalCdf matches known quantiles and handles extreme arguments", () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 12);
    expect(normalCdf(-1.959963984540054)).toBeCloseTo(0.025, 12);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 14);
    expect(normalCdf(-3)).toBeCloseTo(0.0013498980316301035, 15);
    expect(normalCdf(-40)).toBeGreaterThanOrEqual(0);
    expect(normalCdf(-40)).toBeLessThan(1e-300);
    expect(normalCdf(40)).toBe(1);
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
  });

  it("[PRICING] normalPdf is the standard density", () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989422804014327, 16);
    expect(normalPdf(1)).toBeCloseTo(0.24197072451914337, 16);
    expect(normalPdf(-2)).toBe(normalPdf(2));
  });
});

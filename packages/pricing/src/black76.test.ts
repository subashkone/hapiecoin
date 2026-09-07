import { describe, expect, it } from "vitest";
import { black76Greeks, black76Price, impliedVol, intrinsicValue } from "./black76.js";
import { normalCdf } from "./normal.js";

const ATM_100_1Y_20 = 7.965567455405804; // 100 × (N(0.1) − N(−0.1))

describe("[PRICING] black76Price", () => {
  it("[PRICING] reproduces the at-the-money closed form and discounts with the rate", () => {
    expect(black76Price(100, 100, 1, 0.2, true)).toBeCloseTo(ATM_100_1Y_20, 12);
    expect(black76Price(100, 100, 1, 0.2, false)).toBeCloseTo(ATM_100_1Y_20, 12);
    expect(black76Price(100, 100, 1, 0.2, true, 0.05)).toBeCloseTo(ATM_100_1Y_20 * Math.exp(-0.05), 12);
    // Off the money: check against the textbook formula written out in full.
    const d1 = (Math.log(100 / 90) + 0.5 * 0.09 * 0.5) / (0.3 * Math.sqrt(0.5));
    const d2 = d1 - 0.3 * Math.sqrt(0.5);
    expect(black76Price(100, 90, 0.5, 0.3, true)).toBeCloseTo(100 * normalCdf(d1) - 90 * normalCdf(d2), 12);
    expect(black76Price(100, 90, 0.5, 0.3, false)).toBeCloseTo(90 * normalCdf(-d2) - 100 * normalCdf(-d1), 12);
  });

  it("[PRICING] satisfies put-call parity C − P = e^(−rT)(F − K) on a grid", () => {
    for (const F of [50, 100, 150]) {
      for (const K of [80, 100, 120]) {
        for (const T of [0.01, 0.25, 2]) {
          for (const r of [0, 0.04]) {
            const c = black76Price(F, K, T, 0.35, true, r);
            const p = black76Price(F, K, T, 0.35, false, r);
            expect(c - p).toBeCloseTo(Math.exp(-r * T) * (F - K), 9);
          }
        }
      }
    }
  });

  it("[PRICING] is monotone in sigma and in F for calls, and bounded by intrinsic and forward", () => {
    let prev = -1;
    for (let sigma = 0.05; sigma <= 3; sigma += 0.05) {
      const price = black76Price(100, 110, 0.5, sigma, true);
      expect(price).toBeGreaterThan(prev);
      prev = price;
    }
    prev = -1;
    for (let F = 50; F <= 200; F += 5) {
      const price = black76Price(F, 110, 0.5, 0.4, true);
      expect(price).toBeGreaterThan(prev);
      expect(price).toBeGreaterThanOrEqual(intrinsicValue(F, 110, true));
      expect(price).toBeLessThanOrEqual(F);
      const put = black76Price(F, 110, 0.5, 0.4, false);
      expect(put).toBeGreaterThanOrEqual(intrinsicValue(F, 110, false));
      expect(put).toBeLessThanOrEqual(110);
      prev = price;
    }
  });

  it("[PRICING] returns intrinsic value at or after settlement and for zero volatility", () => {
    expect(black76Price(120, 100, 0, 0.5, true)).toBe(20);
    expect(black76Price(120, 100, -0.1, 0.5, false)).toBe(0);
    expect(black76Price(90, 100, 1, 0, false)).toBe(10);
    expect(black76Price(90, 100, 1, -1, true, 0.1)).toBe(0);
    expect(black76Price(120, 100, 1, 0, true, 0.1)).toBeCloseTo(20 * Math.exp(-0.1), 12);
    expect(intrinsicValue(95, 100, false)).toBe(5);
  });

  it("[PRICING] returns NaN for invalid inputs instead of throwing", () => {
    expect(black76Price(0, 100, 1, 0.2, true)).toBeNaN();
    expect(black76Price(100, -5, 1, 0.2, true)).toBeNaN();
    expect(black76Price(100, 100, NaN, 0.2, true)).toBeNaN();
    expect(black76Price(100, 100, 1, Infinity, true)).toBeNaN();
    expect(black76Price(100, 100, 1, 0.2, true, NaN)).toBeNaN();
    expect(black76Price(Infinity, 100, 1, 0.2, true)).toBeNaN();
  });
});

describe("[PRICING] black76Greeks", () => {
  const cases: [number, number, number, number, boolean, number][] = [
    [100, 100, 1, 0.2, true, 0],
    [100, 90, 0.5, 0.3, true, 0.03],
    [100, 120, 0.25, 0.6, false, 0.03],
    [80_000, 82_000, 0.05, 0.45, false, 0],
  ];

  it("[PRICING] agree with central finite differences of the price", () => {
    for (const [F, K, T, sigma, isCall, r] of cases) {
      const g = black76Greeks(F, K, T, sigma, isCall, r);
      const price = (f = F, k = K, t = T, s = sigma, rate = r): number => black76Price(f, k, t, s, isCall, rate);
      const hF = F * 1e-4;
      expect(g.delta).toBeCloseTo((price(F + hF) - price(F - hF)) / (2 * hF), 6);
      expect(g.gamma).toBeCloseTo((price(F + hF) - 2 * price() + price(F - hF)) / (hF * hF), 6);
      const hS = 1e-4;
      expect(g.vega).toBeCloseTo(((price(F, K, T, sigma + hS) - price(F, K, T, sigma - hS)) / (2 * hS)) * 0.01, 6);
      const hT = 1e-6;
      const dPdT = (price(F, K, T + hT) - price(F, K, T - hT)) / (2 * hT);
      expect(g.theta).toBeCloseTo(-dPdT / 365, 5);
      const hR = 1e-6;
      expect(g.rho).toBeCloseTo(((price(F, K, T, sigma, r + hR) - price(F, K, T, sigma, r - hR)) / (2 * hR)) * 0.01, 6);
    }
  });

  it("[PRICING] put delta = call delta − e^(−rT); gamma and vega are shared", () => {
    const c = black76Greeks(100, 95, 0.75, 0.25, true, 0.02);
    const p = black76Greeks(100, 95, 0.75, 0.25, false, 0.02);
    expect(p.delta).toBeCloseTo(c.delta - Math.exp(-0.02 * 0.75), 12);
    expect(p.gamma).toBeCloseTo(c.gamma, 14);
    expect(p.vega).toBeCloseTo(c.vega, 12);
  });

  it("[PRICING] collapses to the moneyness indicator at settlement or with zero volatility", () => {
    expect(black76Greeks(120, 100, 0, 0.3, true)).toEqual({ delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 });
    expect(black76Greeks(100, 100, -1, 0.3, true).delta).toBe(0.5);
    expect(black76Greeks(80, 100, 0, 0.3, true).delta).toBe(0);
    expect(black76Greeks(80, 100, 0, 0.3, false).delta).toBe(-1);
    expect(black76Greeks(100, 100, 0, 0.3, false).delta).toBe(-0.5);
    expect(black76Greeks(120, 100, 0, 0.3, false).delta).toBe(-0);
    expect(black76Greeks(120, 100, 1, 0, true, 0.1).delta).toBeCloseTo(Math.exp(-0.1), 12);
  });

  it("[PRICING] returns NaN greeks for invalid inputs", () => {
    const g = black76Greeks(-1, 100, 1, 0.2, true);
    expect(g).toEqual({ delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN });
  });
});

describe("[PRICING] impliedVol", () => {
  it("[PRICING] recovers sigma from the price across moneyness, tenor and rate for calls and puts", () => {
    let checked = 0;
    let skipped = 0;
    for (const F of [100, 80_000]) {
      for (const m of [0.7, 0.9, 1, 1.1, 1.4]) {
        for (const T of [0.003, 0.05, 0.5, 2]) {
          for (const sigma of [0.15, 0.45, 1.2]) {
            for (const isCall of [true, false]) {
              const r = 0.02;
              const price = black76Price(F, F * m, T, sigma, isCall, r);
              const timeValue = price - Math.exp(-r * T) * intrinsicValue(F, F * m, isCall);
              // With no time value left in double precision (deep in or out of the money, days to expiry) the
              // price carries no vol information; the solver then returns a bracket edge, not sigma.
              if (timeValue < 1e-6 * F) {
                skipped++;
                continue;
              }
              checked++;
              const iv = impliedVol(price, F, F * m, T, isCall, { r });
              expect(Math.abs(iv - sigma)).toBeLessThan(1e-7);
            }
          }
        }
      }
    }
    expect(checked).toBe(192);
    expect(checked + skipped).toBe(240);
  });

  it("[PRICING] returns NaN only outside the no-arbitrage bounds, for settled options or invalid inputs", () => {
    expect(impliedVol(19.9, 120, 100, 1, true)).toBeNaN(); // below intrinsic
    expect(impliedVol(100.1, 100, 100, 1, true)).toBeNaN(); // above the forward
    expect(impliedVol(100.1, 100, 100, 1, false)).toBeNaN(); // above the strike
    expect(impliedVol(-1, 100, 100, 1, false)).toBeNaN();
    expect(impliedVol(5, 100, 100, 0, true)).toBeNaN(); // settled
    expect(impliedVol(5, 0, 100, 1, true)).toBeNaN();
    expect(impliedVol(NaN, 100, 100, 1, true)).toBeNaN();
    // Exactly on the bounds is inside them.
    expect(impliedVol(20, 120, 100, 1, true)).toBe(0.01);
    expect(impliedVol(100, 100, 100, 1, true)).toBe(5);
  });

  it("[PRICING] clamps to the bracket edges when the root lies outside [lo, hi]", () => {
    const tiny = black76Price(100, 100, 1, 0.005, true);
    expect(impliedVol(tiny, 100, 100, 1, true)).toBe(0.01);
    const huge = black76Price(100, 100, 1, 6, true);
    expect(impliedVol(huge, 100, 100, 1, true)).toBe(5);
    expect(impliedVol(huge, 100, 100, 1, true, { hi: 8 })).toBeCloseTo(6, 7);
  });

  it("[PRICING] returns immediately on an exact hit and honours maxIter", () => {
    // The seed falls outside a narrow bracket, so the first trial is the bracket midpoint 0.3.
    const price = black76Price(100, 120, 1, 0.3, true);
    expect(impliedVol(price, 100, 120, 1, true, { lo: 0.25, hi: 0.35 })).toBe(0.3);
    const one = impliedVol(black76Price(100, 100, 1, 0.4, true), 100, 100, 1, true, { maxIter: 1 });
    expect(one).toBeGreaterThan(0.01);
    expect(one).toBeLessThan(5);
    expect(Math.abs(one - 0.4)).toBeGreaterThan(1e-8);
  });

  it("[PRICING] falls back to bisection where vega vanishes (deep out of the money, short tenor)", () => {
    const price = black76Price(100, 300, 0.01, 0.45, true);
    expect(price).toBeGreaterThan(0);
    const iv = impliedVol(price, 100, 300, 0.01, true, { lo: 0.01, hi: 0.5 });
    expect(Math.abs(iv - 0.45)).toBeLessThan(1e-6);
  });
});

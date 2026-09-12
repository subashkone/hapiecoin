import { describe, expect, it } from "vitest";
import { black76Greeks, black76Price, impliedVol } from "./black76.js";
import { bsmGreeks, bsmImpliedVol, bsmPrice, forwardPrice } from "./bsm.js";
import { normalCdf } from "./normal.js";

describe("HC-SH-121 [PRICING] Black-Scholes-Merton with carry", () => {
  it("equals Black-76 on the spot to the bit when r = q = 0 (what the apps price today)", () => {
    for (const [S, K, T, sigma] of [
      [80_000, 82_000, 0.05, 0.45],
      [4_000, 3_800, 0.3, 0.7],
      [3_425.5, 3_400, 0.002, 0.2],
    ] as const) {
      for (const isCall of [true, false]) {
        expect(bsmPrice(S, K, T, sigma, isCall)).toBe(black76Price(S, K, T, sigma, isCall));
        expect(bsmGreeks(S, K, T, sigma, isCall)).toEqual(black76Greeks(S, K, T, sigma, isCall));
        const p = black76Price(S, K, T, sigma, isCall);
        expect(bsmImpliedVol(p, S, K, T, isCall)).toBe(impliedVol(p, S, K, T, isCall));
      }
    }
  });

  it("reproduces the textbook vector: S 42, K 40, r 10 %, T 0.5, sigma 20 % -> call 4.76, put 0.81", () => {
    expect(bsmPrice(42, 40, 0.5, 0.2, true, 0.1)).toBeCloseTo(4.7594, 3);
    expect(bsmPrice(42, 40, 0.5, 0.2, false, 0.1)).toBeCloseTo(0.8086, 3);
    // put-call parity on spot: C - P = S e^{-qT} - K e^{-rT}
    const c = bsmPrice(42, 40, 0.5, 0.2, true, 0.1, 0.03);
    const p = bsmPrice(42, 40, 0.5, 0.2, false, 0.1, 0.03);
    expect(c - p).toBeCloseTo(42 * Math.exp(-0.03 * 0.5) - 40 * Math.exp(-0.1 * 0.5), 10);
  });

  it("a carry yield lowers the forward, the call and the call delta, and raises the put", () => {
    const base = bsmPrice(100, 100, 1, 0.25, true, 0.05);
    const withQ = bsmPrice(100, 100, 1, 0.25, true, 0.05, 0.04);
    expect(forwardPrice(100, 1, 0.05, 0.04)).toBeCloseTo(100 * Math.exp(0.01), 12);
    expect(withQ).toBeLessThan(base);
    expect(bsmPrice(100, 100, 1, 0.25, false, 0.05, 0.04)).toBeGreaterThan(bsmPrice(100, 100, 1, 0.25, false, 0.05));
    // BSM call delta is e^{-qT} N(d1)
    const T = 1;
    const F = forwardPrice(100, T, 0.05, 0.04);
    const d1 = (Math.log(F / 100) + 0.5 * 0.25 * 0.25 * T) / (0.25 * Math.sqrt(T));
    expect(bsmGreeks(100, 100, T, 0.25, true, 0.05, 0.04).delta).toBeCloseTo(Math.exp(-0.04 * T) * normalCdf(d1), 12);
  });

  it("delta and gamma are per unit of spot: they match finite differences of the price", () => {
    const [S, K, T, sigma, r, q] = [100, 95, 0.4, 0.3, 0.06, 0.02];
    const h = 0.01;
    const price = (s: number) => bsmPrice(s, K, T, sigma, true, r, q);
    const g = bsmGreeks(S, K, T, sigma, true, r, q);
    expect(g.delta).toBeCloseTo((price(S + h) - price(S - h)) / (2 * h), 6);
    expect(g.gamma).toBeCloseTo((price(S + h) - 2 * price(S) + price(S - h)) / (h * h), 4);
    expect(g.vega).toBeCloseTo((bsmPrice(S, K, T, sigma + 0.0001, true, r, q) - bsmPrice(S, K, T, sigma - 0.0001, true, r, q)) / 0.0002 / 100, 6);
    // theta is the decay per day at a fixed spot: the forward drifts with the time left
    const dt = 1 / 365;
    expect(g.theta).toBeCloseTo((bsmPrice(S, K, T - dt / 2, sigma, true, r, q) - bsmPrice(S, K, T + dt / 2, sigma, true, r, q)) / 1, 3);
    expect(bsmGreeks(80_000, 80_000, 0.1, 0.5, true, 0.05).theta).toBeLessThan(black76Greeks(80_000, 80_000, 0.1, 0.5, true, 0.05).theta);
  });

  it("implied volatility under carry inverts the price, and invalid inputs give NaN everywhere", () => {
    const sigma = 0.37;
    const p = bsmPrice(100, 110, 0.75, sigma, true, 0.05, 0.02);
    expect(bsmImpliedVol(p, 100, 110, 0.75, true, { r: 0.05, q: 0.02 })).toBeCloseTo(sigma, 7);
    expect(bsmImpliedVol(p, 100, 110, 0.75, true, { r: 0.05 })).not.toBeCloseTo(sigma, 3); // the carry matters
    expect(forwardPrice(0, 1)).toBeNaN();
    expect(forwardPrice(100, Number.NaN)).toBeNaN();
    expect(forwardPrice(100, 1, Number.POSITIVE_INFINITY)).toBeNaN();
    expect(bsmPrice(-1, 100, 1, 0.2, true)).toBeNaN();
    expect(bsmGreeks(100, 100, 1, 0.2, true, Number.NaN)).toEqual({ delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN });
    expect(bsmImpliedVol(5, 100, 100, 1, true, { q: Number.NaN })).toBeNaN();
    expect(forwardPrice(100, -1, 0.1)).toBe(100); // settled: no growth
  });
});

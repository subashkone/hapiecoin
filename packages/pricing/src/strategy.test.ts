import { describe, expect, it } from "vitest";
import { black76Greeks, black76Price } from "./black76.js";
import { normalCdf } from "./normal.js";
import {
  MIN_IV,
  analyze,
  breakevens,
  expiryExtremes,
  legValueAtExpiry,
  netPremium,
  payoffAtDate,
  payoffAtExpiry,
  positionGreeksAt,
  probabilityOfProfit,
  rewardRisk,
  scenarioGrid,
} from "./strategy.js";
import { MS_PER_DAY, expiryMs, yearFraction } from "./time.js";
import type { Leg } from "./types.js";

const SPOT = 79_528.1;
const NOW = 1788543685911.107; // 2026-09-04T17:41:25.911Z
const EXPIRY = "2026-09-25";
const QTY = 0.01; // 10 contracts × 0.001 BTC

const leg = (partial: Partial<Leg> & Pick<Leg, "kind" | "side" | "strike" | "price">): Leg => ({
  expiry: EXPIRY,
  quantity: QTY,
  iv: 0.42,
  ...partial,
});

const bullCallSpread: Leg[] = [
  leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: 0.42 }),
  leg({ kind: "call", side: "sell", strike: 82_000, price: 1700, iv: 0.43 }),
];

describe("HC-WS-057 net premium", () => {
  it("HC-WS-057 is negative for a debit spread and positive for a credit, futures carry none", () => {
    expect(netPremium(bullCallSpread)).toBeCloseTo(-8, 10);
    expect(netPremium([leg({ kind: "put", side: "sell", strike: 78_000, price: 1500 })])).toBeCloseTo(15, 10);
    expect(netPremium([leg({ kind: "future", side: "buy", strike: 0, price: 79_000 })])).toBe(0);
    expect(netPremium([])).toBe(0);
  });
});

describe("HC-WS-033 expiry payoff, extremes and reward / risk", () => {
  it("HC-WS-033 values each leg at its own expiry", () => {
    expect(legValueAtExpiry(bullCallSpread[0] as Leg, 81_000)).toBe(1000);
    expect(legValueAtExpiry(leg({ kind: "put", side: "buy", strike: 80_000, price: 1 }), 79_000)).toBe(1000);
    expect(legValueAtExpiry(leg({ kind: "future", side: "buy", strike: 0, price: 1 }), 79_000)).toBe(79_000);
    expect(payoffAtExpiry(bullCallSpread, 70_000)).toBeCloseTo(-8, 10);
    expect(payoffAtExpiry(bullCallSpread, 81_000)).toBeCloseTo(2, 10);
    expect(payoffAtExpiry(bullCallSpread, 90_000)).toBeCloseTo(12, 10);
  });

  it("HC-WS-033 bull call spread: max profit (K2 − K1 − debit), max loss (debit), R:R 1.5", () => {
    const { maxProfit, maxLoss } = expiryExtremes(bullCallSpread);
    expect(maxProfit).toBeCloseTo(12, 10);
    expect(maxLoss).toBeCloseTo(-8, 10);
    expect(rewardRisk(maxProfit, maxLoss)).toBeCloseTo(1.5, 10);
  });

  it("HC-WS-033 unbounded sides: long call, short call, futures", () => {
    const longCall = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500 })];
    expect(expiryExtremes(longCall)).toEqual({ maxProfit: Infinity, maxLoss: -25 });
    const shortCall = [leg({ kind: "call", side: "sell", strike: 80_000, price: 2500 })];
    expect(expiryExtremes(shortCall)).toEqual({ maxProfit: 25, maxLoss: -Infinity });
    const longFuture = [leg({ kind: "future", side: "buy", strike: 0, price: 79_000 })];
    expect(expiryExtremes(longFuture)).toEqual({ maxProfit: Infinity, maxLoss: -790 });
    const shortFuture = [leg({ kind: "future", side: "sell", strike: 0, price: 79_000 })];
    expect(expiryExtremes(shortFuture)).toEqual({ maxProfit: 790, maxLoss: -Infinity });
    const shortPut = [leg({ kind: "put", side: "sell", strike: 78_000, price: 1500 })];
    expect(expiryExtremes(shortPut)).toEqual({ maxProfit: 15, maxLoss: -765 });
    expect(expiryExtremes([])).toEqual({ maxProfit: 0, maxLoss: 0 });
  });

  it("HC-WS-081 reward / risk grades every combination of bounded and unbounded extremes", () => {
    expect(rewardRisk(Infinity, -25)).toBe(Infinity);
    expect(rewardRisk(25, -Infinity)).toBe(0);
    expect(rewardRisk(Infinity, -Infinity)).toBeNaN();
    expect(rewardRisk(12, 0)).toBe(Infinity);
    expect(rewardRisk(0, 0)).toBe(0);
    expect(rewardRisk(12, -8)).toBe(1.5);
  });
});

describe("HC-WS-040 breakevens", () => {
  it("HC-WS-053 bull call spread breaks even at K1 + net debit per unit", () => {
    expect(breakevens(bullCallSpread)).toEqual([80_800]);
  });

  it("HC-WS-040 long straddle has two, short put one, a free option touches zero at its strike", () => {
    const straddle = [
      leg({ kind: "call", side: "buy", strike: 80_000, price: 2000 }),
      leg({ kind: "put", side: "buy", strike: 80_000, price: 1500 }),
    ];
    expect(breakevens(straddle)).toEqual([76_500, 83_500]);
    expect(breakevens([leg({ kind: "put", side: "sell", strike: 78_000, price: 1500 })])).toEqual([76_500]);
    expect(breakevens([leg({ kind: "call", side: "buy", strike: 80_000, price: 0 })])).toEqual([80_000]);
    expect(breakevens([leg({ kind: "future", side: "buy", strike: 0, price: 79_000 })])).toEqual([79_000]);
    expect(breakevens([])).toEqual([]);
  });

  it("HC-WS-040 de-duplicates a breakeven shared by two legs at the same strike", () => {
    const legs = [
      leg({ kind: "call", side: "buy", strike: 80_000, price: 0 }),
      leg({ kind: "put", side: "sell", strike: 80_000, price: 0 }),
    ];
    expect(breakevens(legs)).toEqual([80_000]);
  });
});

describe("HC-WS-055 probability of profit", () => {
  const T = yearFraction(NOW, EXPIRY);

  it("HC-WS-055 long call POP equals the lognormal tail above its breakeven", () => {
    const legs = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: 0.42 })];
    const sq = 0.42 * Math.sqrt(T);
    const expected = 1 - normalCdf((Math.log(82_500 / SPOT) + 0.5 * sq * sq) / sq);
    expect(probabilityOfProfit(legs, SPOT, 0.42, T)).toBeCloseTo(expected, 12);
  });

  it("HC-WS-055 is bounded in [0, 1] and complementary for opposite positions", () => {
    const pop = probabilityOfProfit(bullCallSpread, SPOT, 0.42, T);
    expect(pop).toBeGreaterThan(0);
    expect(pop).toBeLessThan(1);
    const inverse: Leg[] = bullCallSpread.map((l) => ({ ...l, side: l.side === "buy" ? "sell" : "buy" }));
    expect(pop + probabilityOfProfit(inverse, SPOT, 0.42, T)).toBeCloseTo(1, 12);
    expect(probabilityOfProfit([leg({ kind: "call", side: "buy", strike: 80_000, price: 0 })], SPOT, 0.42, T)).toBeGreaterThan(0.4);
  });

  it("HC-WS-055 is certain at settlement or with zero volatility, NaN without a volatility", () => {
    expect(probabilityOfProfit(bullCallSpread, 81_000, 0.42, 0)).toBe(1);
    expect(probabilityOfProfit(bullCallSpread, 79_000, 0.42, -0.01)).toBe(0);
    expect(probabilityOfProfit(bullCallSpread, 81_000, 0, T)).toBe(1);
    expect(probabilityOfProfit(bullCallSpread, SPOT, NaN, T)).toBeNaN();
    expect(probabilityOfProfit(bullCallSpread, SPOT, 0.42, NaN)).toBeNaN();
  });
});

describe("HC-WS-059 position greeks and target-date valuation", () => {
  it("HC-WS-060 net greeks are the signed, size-weighted sum of per-leg Black-76 greeks", () => {
    const g = positionGreeksAt(bullCallSpread, SPOT, NOW);
    const T = yearFraction(NOW, EXPIRY);
    const a = black76Greeks(SPOT, 80_000, T, 0.42, true);
    const b = black76Greeks(SPOT, 82_000, T, 0.43, true);
    expect(g.delta).toBeCloseTo(QTY * (a.delta - b.delta), 12);
    expect(g.gamma).toBeCloseTo(QTY * (a.gamma - b.gamma), 12);
    expect(g.theta).toBeCloseTo(QTY * (a.theta - b.theta), 12);
    expect(g.vega).toBeCloseTo(QTY * (a.vega - b.vega), 12);
    expect(g.rho).toBeCloseTo(QTY * (a.rho - b.rho), 12);
  });

  it("HC-WS-059 futures contribute delta only; settled options contribute the moneyness indicator", () => {
    const legs = [
      leg({ kind: "future", side: "sell", strike: 0, price: 79_000, quantity: 0.02 }),
      leg({ kind: "put", side: "buy", strike: 80_000, price: 1000, expiry: "2026-09-01", iv: undefined }),
    ];
    const g = positionGreeksAt(legs, SPOT, NOW);
    expect(g).toEqual({ delta: -0.02 - QTY, gamma: 0, theta: 0, vega: 0, rho: 0 });
  });

  it("HC-WS-083 payoffAtDate re-prices unexpired legs and honours an additive IV shift", () => {
    const longCall = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: 0.42 })];
    const T = yearFraction(NOW, EXPIRY);
    expect(payoffAtDate(longCall, SPOT, NOW)).toBeCloseTo(QTY * (black76Price(SPOT, 80_000, T, 0.42, true) - 2500), 10);
    expect(payoffAtDate(longCall, SPOT, NOW, 0.05)).toBeCloseTo(QTY * (black76Price(SPOT, 80_000, T, 0.47, true) - 2500), 10);
    expect(payoffAtDate(longCall, SPOT, NOW, 0.05)).toBeGreaterThan(payoffAtDate(longCall, SPOT, NOW));
    // A shift below zero is floored at MIN_IV: the option is worth (almost) its intrinsic value.
    expect(payoffAtDate(longCall, 81_000, NOW, -1)).toBeCloseTo(QTY * (black76Price(81_000, 80_000, T, MIN_IV, true) - 2500), 10);
    expect(payoffAtDate(longCall, 81_000, NOW, -1)).toBeCloseTo(QTY * (1000 - 2500), 3);
    // On or after settlement the target curve is the expiry payoff.
    const settled = Date.UTC(2026, 8, 25, 12);
    expect(payoffAtDate(bullCallSpread, 81_000, settled)).toBeCloseTo(payoffAtExpiry(bullCallSpread, 81_000), 12);
  });

  it("HC-WS-083 legs without an IV use defaultIv or throw before expiry, never after it", () => {
    const noIv = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: undefined })];
    expect(() => payoffAtDate(noIv, SPOT, NOW)).toThrow(/no implied volatility/);
    expect(() => payoffAtDate([leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: NaN })], SPOT, NOW)).toThrow(
      RangeError,
    );
    expect(payoffAtDate(noIv, SPOT, NOW, 0, { defaultIv: 0.42 })).toBeCloseTo(payoffAtDate(bullCallSpread.slice(0, 1), SPOT, NOW), 12);
    expect(payoffAtDate(noIv, SPOT, Date.UTC(2026, 9, 1))).toBeCloseTo(-25, 12);
  });

  it("HC-WS-083 rejects a non-positive underlying price", () => {
    expect(() => payoffAtDate(bullCallSpread, 0, NOW)).toThrow(RangeError);
    expect(() => positionGreeksAt(bullCallSpread, -1, NOW)).toThrow(RangeError);
    expect(() => payoffAtDate(bullCallSpread, Infinity, NOW)).toThrow(RangeError);
  });
});

describe("HC-WS-033 analyze", () => {
  it("HC-WS-033 assembles the six summary tiles for a bull call spread", () => {
    const r = analyze(bullCallSpread, { spot: SPOT, nowMs: NOW });
    expect(r.maxProfit).toBeCloseTo(12, 10);
    expect(r.maxLoss).toBeCloseTo(-8, 10);
    expect(r.netPremium).toBeCloseTo(-8, 10);
    expect(r.breakevens).toEqual([80_800]);
    expect(r.rewardRisk).toBeCloseTo(1.5, 10);
    expect(r.pop).toBeGreaterThan(0);
    expect(r.pop).toBeLessThan(1);
    expect(r.atmIv).toBe(0.42); // the 80 000 strike is nearest the spot
    expect(r.daysToNearestExpiry).toBeCloseTo(20.76, 2);
    expect(r.expectedMove).toBeCloseTo(SPOT * 0.42 * Math.sqrt(yearFraction(NOW, EXPIRY)), 8);
    expect(r.points).toHaveLength(161);
    expect(r.points[0]?.price).toBeCloseTo(SPOT * 0.8, 8);
    expect(r.points[160]?.price).toBeCloseTo(SPOT * 1.2, 8); // max(spot × 1.2, 82 000 × 1.05)
    const far = analyze([leg({ kind: "call", side: "buy", strike: 120_000, price: 10 })], { spot: SPOT, nowMs: NOW });
    expect(far.points[160]?.price).toBeCloseTo(126_000, 8); // 120 000 × 1.05 beats spot × 1.2
    const low = analyze([leg({ kind: "put", side: "buy", strike: 40_000, price: 10 })], { spot: SPOT, nowMs: NOW });
    expect(low.points[0]?.price).toBeCloseTo(38_000, 8); // 40 000 × 0.95 beats spot × 0.8
    expect(r.points[160]?.pnlExpiry).toBeCloseTo(12, 10);
    expect(r.targetMs).toBe(NOW);
    expect(r.target.price).toBe(SPOT);
    expect(r.target.pnlExpiry).toBeCloseTo(payoffAtExpiry(bullCallSpread, SPOT), 12);
    expect(r.target.pnlTarget).toBeCloseTo(payoffAtDate(bullCallSpread, SPOT, NOW), 12);
    expect(r.greeks).toEqual(positionGreeksAt(bullCallSpread, SPOT, NOW));
  });

  it("HC-WS-048 target date, target spot, IV shift and price range flow through", () => {
    const r = analyze(bullCallSpread, {
      spot: SPOT,
      nowMs: NOW,
      targetDays: 10,
      targetSpot: 81_000,
      ivShift: 0.05,
      priceRange: [70_000, 90_000],
      points: 5,
    });
    expect(r.targetMs).toBe(NOW + 10 * MS_PER_DAY);
    expect(r.points.map((p) => p.price)).toEqual([70_000, 75_000, 80_000, 85_000, 90_000]);
    expect(r.target.price).toBe(81_000);
    expect(r.target.pnlTarget).toBeCloseTo(payoffAtDate(bullCallSpread, 81_000, NOW + 10 * MS_PER_DAY, 0.05), 12);
    expect(r.greeks).toEqual(positionGreeksAt(bullCallSpread, SPOT, NOW, 0.05));
  });

  it("HC-WS-062 ATM IV precedence: option, nearest-strike leg, defaultIv, else NaN", () => {
    expect(analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, atmIv: 0.5 }).atmIv).toBe(0.5);
    expect(analyze(bullCallSpread, { spot: 81_900, nowMs: NOW }).atmIv).toBe(0.43);
    const noIv = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, iv: undefined })];
    const withDefault = analyze(noIv, { spot: SPOT, nowMs: NOW, defaultIv: 0.3 });
    expect(withDefault.atmIv).toBe(0.3);
    expect(withDefault.pop).toBeGreaterThan(0);
    const settled = analyze(noIv, { spot: SPOT, nowMs: Date.UTC(2026, 9, 1) });
    expect(settled.atmIv).toBeNaN();
    expect(settled.pop).toBeNaN();
    expect(settled.expectedMove).toBeNaN();
    expect(settled.daysToNearestExpiry).toBeLessThan(0);
  });

  it("HC-WS-033 futures-only and empty strategies", () => {
    const future = analyze([leg({ kind: "future", side: "buy", strike: 0, price: 79_000, iv: undefined })], { spot: SPOT, nowMs: NOW });
    expect(future.maxProfit).toBe(Infinity);
    expect(future.maxLoss).toBeCloseTo(-790, 10);
    expect(future.breakevens).toEqual([79_000]);
    expect(future.daysToNearestExpiry).toBeNaN();
    expect(future.pop).toBeNaN();
    expect(future.expectedMove).toBeNaN();
    expect(future.greeks.delta).toBeCloseTo(QTY, 12);
    const empty = analyze([], { spot: SPOT, nowMs: NOW });
    expect(empty.maxProfit).toBe(0);
    expect(empty.maxLoss).toBe(0);
    expect(empty.rewardRisk).toBe(0);
    expect(empty.breakevens).toEqual([]);
    expect(empty.points.every((p) => p.pnlExpiry === 0 && p.pnlTarget === 0)).toBe(true);
  });

  it("HC-WS-055 an expired strategy has a certain POP and a zero expected move", () => {
    const later = Date.UTC(2026, 9, 1);
    const r = analyze(bullCallSpread, { spot: 81_000, nowMs: later });
    expect(r.pop).toBe(1);
    expect(r.expectedMove).toBe(0);
    expect(analyze(bullCallSpread, { spot: 79_000, nowMs: later }).pop).toBe(0);
  });

  it("HC-WS-033 nearest expiry across mixed expiries and XAUT settlement hour", () => {
    const mixed = [
      leg({ kind: "call", side: "buy", strike: 80_000, price: 2500, expiry: "2026-10-30" }),
      leg({ kind: "call", side: "sell", strike: 82_000, price: 1700, expiry: "2026-09-11" }),
    ];
    expect(analyze(mixed, { spot: SPOT, nowMs: NOW }).daysToNearestExpiry).toBeCloseTo(6.76, 2);
    const xaut = analyze(mixed, { spot: SPOT, nowMs: NOW, settlementHourUtc: 16 });
    expect(xaut.daysToNearestExpiry).toBeCloseTo(6.76 + 4 / 24, 2);
  });

  it("HC-WS-033 rejects invalid inputs", () => {
    expect(() => analyze(bullCallSpread, { spot: 0, nowMs: NOW })).toThrow(RangeError);
    expect(() => analyze(bullCallSpread, { spot: SPOT, nowMs: NaN })).toThrow(/nowMs/);
    expect(() => analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, points: 1 })).toThrow(/points/);
    expect(() => analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, points: 2.5 })).toThrow(/points/);
    expect(() => analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, priceRange: [0, 1] })).toThrow(/priceRange/);
    expect(() => analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, priceRange: [100, 50] })).toThrow(/priceRange/);
  });

  it("[PRICING] analyze with 4 legs × 161 points stays well under 50 ms", () => {
    const condor = [
      leg({ kind: "put", side: "buy", strike: 74_000, price: 400, iv: 0.5 }),
      leg({ kind: "put", side: "sell", strike: 76_000, price: 800, iv: 0.47 }),
      leg({ kind: "call", side: "sell", strike: 82_000, price: 1700, iv: 0.43 }),
      leg({ kind: "call", side: "buy", strike: 84_000, price: 1100, iv: 0.44 }),
    ];
    analyze(condor, { spot: SPOT, nowMs: NOW, targetDays: 7 }); // warm-up
    const t0 = performance.now();
    const r = analyze(condor, { spot: SPOT, nowMs: NOW, targetDays: 7 });
    const elapsed = performance.now() - t0;
    expect(r.points).toHaveLength(161);
    expect(r.breakevens).toHaveLength(2);
    expect(elapsed).toBeLessThan(50);
    process.stdout.write(`[PRICING] analyze(4 legs × 161 points) took ${elapsed.toFixed(3)} ms\n`);
  });
});

describe("HC-WS-062 scenario grid", () => {
  const prices = [76_000, 79_528.1, 83_000];
  const dates = [NOW, NOW + 7 * MS_PER_DAY, Date.UTC(2026, 8, 25, 12)];

  it("HC-WS-062 holds one P&L per date × price and equals the expiry payoff on the settlement row", () => {
    const grid = scenarioGrid(bullCallSpread, { prices, dates });
    expect(grid.mode).toBe("pnl");
    expect(grid.prices).toEqual(prices);
    expect(grid.dates).toEqual(dates);
    expect(grid.values).toHaveLength(3);
    for (let d = 0; d < dates.length; d++) {
      for (let p = 0; p < prices.length; p++) {
        expect(grid.values[d]?.[p]).toBeCloseTo(payoffAtDate(bullCallSpread, prices[p] as number, dates[d] as number), 12);
      }
    }
    expect(grid.values[2]?.[2]).toBeCloseTo(payoffAtExpiry(bullCallSpread, 83_000), 12);
  });

  it("HC-WS-089 delta and theta modes re-price every leg with Black-76", () => {
    const delta = scenarioGrid(bullCallSpread, { prices, dates, mode: "delta", ivShift: 0.02 });
    const theta = scenarioGrid(bullCallSpread, { prices, dates, mode: "theta" });
    expect(delta.values[1]?.[0]).toBeCloseTo(positionGreeksAt(bullCallSpread, 76_000, dates[1] as number, 0.02).delta, 12);
    expect(theta.values[0]?.[1]).toBeCloseTo(positionGreeksAt(bullCallSpread, SPOT, NOW).theta, 12);
    expect(theta.values[2]?.[1]).toBe(0);
  });

  it("HC-WS-062 rejects non-positive prices", () => {
    expect(() => scenarioGrid(bullCallSpread, { prices: [0], dates })).toThrow(RangeError);
  });
});

describe("ADR-044 valuation at a date (adjustment workbench, other expiries)", () => {
  const LATER = "2026-10-30";
  const calendar: Leg[] = [
    leg({ kind: "call", side: "sell", strike: 80_000, price: 2500, iv: 0.42 }), // near expiry
    leg({ kind: "call", side: "buy", strike: 80_000, price: 3400, iv: 0.45, expiry: LATER }), // far expiry
  ];

  it("valued at the latest expiry, every leg is intrinsic: the same figures as the exact expiry path", () => {
    const exact = analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, points: 41 });
    const at = analyze(bullCallSpread, { spot: SPOT, nowMs: NOW, points: 41, valuationMs: expiryMs(EXPIRY) });
    expect(at.valuationMs).toBe(expiryMs(EXPIRY));
    expect(exact.valuationMs).toBeNull();
    expect(at.maxProfit).toBeCloseTo(exact.maxProfit, 6);
    expect(at.maxLoss).toBeCloseTo(exact.maxLoss, 6);
    expect(at.breakevens.length).toBe(1);
    expect(at.breakevens[0]).toBeCloseTo(exact.breakevens[0] as number, 3);
    expect(at.pop).toBeCloseTo(exact.pop, 6);
    at.points.forEach((p, i) => expect(p.pnlExpiry).toBeCloseTo(exact.points[i]!.pnlExpiry, 6));
  });

  it("a calendar valued at the near expiry keeps the far leg's time value: both sides bounded, a profit peak at the strike", () => {
    const r = analyze(calendar, { spot: SPOT, nowMs: NOW, points: 81, valuationMs: expiryMs(EXPIRY) });
    expect(Number.isFinite(r.maxProfit)).toBe(true);
    expect(Number.isFinite(r.maxLoss)).toBe(true);
    // at the near expiry the short call is intrinsic and the long call is Black-76 at the strike: worth more than intrinsic
    const atStrike = payoffAtDate(calendar, 80_000, expiryMs(EXPIRY));
    expect(r.maxProfit).toBeGreaterThanOrEqual(atStrike - 1e-6);
    expect(r.maxProfit).toBeGreaterThan(payoffAtExpiry(calendar, 80_000));
    // far from the strike the time value fades, so the curve tends to the net debit paid
    expect(r.maxLoss).toBeLessThan(0);
    expect(r.maxLoss).toBeGreaterThanOrEqual(netPremium(calendar) - 1);
    expect(r.breakevens.length).toBe(2);
    expect(r.pop).toBeGreaterThan(0);
    expect(r.pop).toBeLessThan(1);
    const [lo, hi] = r.breakevens as [number, number];
    expect(payoffAtDate(calendar, (lo + hi) / 2, expiryMs(EXPIRY))).toBeGreaterThan(0);
    expect(payoffAtDate(calendar, lo * 0.9, expiryMs(EXPIRY))).toBeLessThan(0);
  });

  it("the lower tail is the exact limit at price 0: a short put valued before expiry risks the same as at expiry", () => {
    const shortPut = [leg({ kind: "put", side: "sell", strike: 78_000, price: 900 })];
    const exact = analyze(shortPut, { spot: SPOT, nowMs: NOW });
    const at = analyze(shortPut, { spot: SPOT, nowMs: NOW, valuationMs: NOW + 5 * MS_PER_DAY });
    expect(at.maxLoss).toBeCloseTo(exact.maxLoss, 6); // −(78,000 − 900) × qty at price 0
    expect(at.maxProfit).toBeCloseTo(exact.maxProfit, 6);
    expect(at.breakevens).toHaveLength(1);
  });

  it("the tails stay analytical: a long call valued before expiry is unbounded above and loses at most the premium", () => {
    const longCall = [leg({ kind: "call", side: "buy", strike: 80_000, price: 2500 })];
    const at = NOW + 10 * MS_PER_DAY;
    const r = analyze(longCall, { spot: SPOT, nowMs: NOW, valuationMs: at });
    expect(r.maxProfit).toBe(Infinity);
    // far below the strike the call is worthless whatever the date, so the loss reaches the premium and no more
    expect(r.maxLoss).toBeCloseTo(-2500 * QTY, 6);
    expect(r.points.every((p) => p.pnlExpiry >= r.maxLoss - 1e-9)).toBe(true);
    expect(r.breakevens.length).toBe(1);
    // before expiry the time value lowers the break-even below K + premium
    expect(r.breakevens[0]).toBeLessThan(82_500);
    expect(r.rewardRisk).toBe(Infinity);
    const shortCall = [leg({ kind: "call", side: "sell", strike: 80_000, price: 2500 })];
    expect(analyze(shortCall, { spot: SPOT, nowMs: NOW, valuationMs: at }).maxLoss).toBe(-Infinity);
  });

  it("a curve that touches zero reports the touch once, and a non-finite valuation instant throws", () => {
    // a free long call (price 0) valued after its expiry is intrinsic: zero up to the strike, positive above
    const free = [leg({ kind: "call", side: "buy", strike: 80_000, price: 0 })];
    const r = analyze(free, { spot: SPOT, nowMs: NOW, points: 21, valuationMs: expiryMs(EXPIRY) + MS_PER_DAY });
    expect(r.breakevens).toEqual([80_000]);
    expect(r.maxLoss).toBe(0);
    expect(() => analyze(free, { spot: SPOT, nowMs: NOW, valuationMs: NaN })).toThrow(RangeError);
  });
});

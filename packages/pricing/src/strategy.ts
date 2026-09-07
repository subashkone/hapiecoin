/**
 * Strategy analytics over a list of legs (HC-WS-033, HC-WS-040, HC-WS-053, HC-WS-055, HC-WS-057, HC-WS-059,
 * HC-WS-060, HC-WS-062, HC-WS-083, HC-WS-089, HC-WS-090).
 *
 * Every figure is in quote currency for the whole position (leg quantities are in underlying units).
 * "At expiry" values each option leg at its own settlement; a future is perpetual and is worth the price.
 * Before expiry a leg is valued with Black-76 on F = price (spot as the forward, zero rate; see black76.ts).
 * `ivShift` is additive in vol points of sigma (+0.05 = five vol points) and applies to scenario valuation and
 * greeks, not to the probability of profit, which is a market figure on the unshifted ATM IV.
 */

import { black76Greeks, black76Price, intrinsicValue } from "./black76.js";
import { normalCdf } from "./normal.js";
import { DAYS_PER_YEAR, DEFAULT_SETTLEMENT_HOUR_UTC, MS_PER_DAY, yearFraction } from "./time.js";
import type { Leg, LegKind } from "./types.js";

/** Floor for sigma after an IV shift so the model never sees a zero or negative volatility. */
export const MIN_IV = 1e-4;

export interface ValuationOptions {
  /** Volatility used for legs that carry no `iv`. Without it such a leg throws when valued before expiry. */
  defaultIv?: number | undefined;
  /** Settlement hour (UTC) for `YYYY-MM-DD` expiries; default 12 (BTC/ETH), XAUT uses 16. */
  settlementHourUtc?: number | undefined;
}

export interface AnalyzeOptions extends ValuationOptions {
  spot: number;
  nowMs: number;
  /** Days from `nowMs` to the target date of the "on target date" curve (default 0 = now). */
  targetDays?: number | undefined;
  /** Price at which the `target` summary point is evaluated (default `spot`). */
  targetSpot?: number | undefined;
  /** Additive shift of every leg's sigma, in vol points (default 0). */
  ivShift?: number | undefined;
  /** Price axis [lo, hi]; default covers spot ±20 % and every strike ±5 %. */
  priceRange?: [number, number] | undefined;
  /** Number of price-axis samples (default 161). */
  points?: number | undefined;
  /** ATM IV for POP and expected move; default the IV of the leg whose strike is nearest the spot. */
  atmIv?: number | undefined;
}

export interface PayoffPoint {
  price: number;
  pnlExpiry: number;
  pnlTarget: number;
}

export interface NetGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface AnalyzeResult {
  points: PayoffPoint[];
  /** Highest expiry P&L; `Infinity` when the payoff rises without bound. */
  maxProfit: number;
  /** Lowest expiry P&L; `-Infinity` when the payoff falls without bound. */
  maxLoss: number;
  /** Underlying prices where the expiry P&L crosses zero, ascending. */
  breakevens: number[];
  /** Positive for a net credit, negative for a net debit. */
  netPremium: number;
  /** Probability of a profit at the nearest expiry under a lognormal on the ATM IV, in [0, 1]; NaN without an IV. */
  pop: number;
  greeks: NetGreeks;
  /** One standard deviation move to the nearest expiry, in price units; NaN without an IV. */
  expectedMove: number;
  /** maxProfit / |maxLoss| (Infinity for unbounded profit or no possible loss, 0 for unbounded loss, NaN if both unbounded). */
  rewardRisk: number;
  /** P&L at `targetSpot`, at expiry and on the target date. */
  target: PayoffPoint;
  targetMs: number;
  /** Calendar days to the nearest option expiry; NaN when no option legs. */
  daysToNearestExpiry: number;
  /** The ATM IV used for POP and expected move (NaN when none was available). */
  atmIv: number;
}

export type ScenarioMode = "pnl" | "delta" | "theta";

export interface ScenarioOptions extends ValuationOptions {
  /** Underlying prices (columns). */
  prices: number[];
  /** Valuation instants in epoch ms (rows). */
  dates: number[];
  ivShift?: number | undefined;
  /** What each cell holds: position P&L (default), position delta, or position theta per day. */
  mode?: ScenarioMode | undefined;
}

export interface ScenarioGrid {
  prices: number[];
  dates: number[];
  mode: ScenarioMode;
  /** `values[dateIndex][priceIndex]`. */
  values: number[][];
}

interface PreparedLeg {
  /** Signed size: +quantity for buys, -quantity for sells. */
  w: number;
  kind: LegKind;
  strike: number;
  price: number;
  T: number;
  sigma: number;
  isCall: boolean;
}

const sideSign = (leg: Leg): number => (leg.side === "buy" ? 1 : -1);

function assertPrice(price: number): void {
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new RangeError(`Underlying price must be a positive finite number, got ${price}`);
  }
}

function legIv(leg: Leg, ivShift: number, defaultIv: number | undefined): number {
  const iv = leg.iv ?? defaultIv;
  if (iv === undefined || !Number.isFinite(iv)) {
    throw new RangeError(
      `Leg ${leg.side} ${leg.kind} ${leg.strike} ${leg.expiry} has no implied volatility; set leg.iv or defaultIv`,
    );
  }
  return Math.max(iv + ivShift, MIN_IV);
}

function prepare(legs: readonly Leg[], atMs: number, ivShift: number, opts: ValuationOptions): PreparedLeg[] {
  const hour = opts.settlementHourUtc ?? DEFAULT_SETTLEMENT_HOUR_UTC;
  return legs.map((leg) => {
    const w = sideSign(leg) * leg.quantity;
    if (leg.kind === "future") {
      return { w, kind: leg.kind, strike: 0, price: leg.price, T: 0, sigma: 0, isCall: false };
    }
    const T = yearFraction(atMs, leg.expiry, hour);
    const sigma = T > 0 ? legIv(leg, ivShift, opts.defaultIv) : 0;
    return { w, kind: leg.kind, strike: leg.strike, price: leg.price, T, sigma, isCall: leg.kind === "call" };
  });
}

function preparedValue(p: PreparedLeg, price: number): number {
  if (p.kind === "future") return price;
  if (p.T <= 0) return intrinsicValue(price, p.strike, p.isCall);
  return black76Price(price, p.strike, p.T, p.sigma, p.isCall);
}

function preparedPnl(prepared: readonly PreparedLeg[], price: number): number {
  let pnl = 0;
  for (const p of prepared) pnl += p.w * (preparedValue(p, price) - p.price);
  return pnl;
}

function preparedGreeks(prepared: readonly PreparedLeg[], price: number): NetGreeks {
  const g: NetGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const p of prepared) {
    if (p.kind === "future") {
      g.delta += p.w;
      continue;
    }
    const lg = black76Greeks(price, p.strike, p.T, p.sigma, p.isCall);
    g.delta += p.w * lg.delta;
    g.gamma += p.w * lg.gamma;
    g.theta += p.w * lg.theta;
    g.vega += p.w * lg.vega;
    g.rho += p.w * lg.rho;
  }
  return g;
}

/** Value of one leg at its own expiry for an underlying price (intrinsic for options, the price for a future). */
export function legValueAtExpiry(leg: Leg, price: number): number {
  if (leg.kind === "future") return price;
  return intrinsicValue(price, leg.strike, leg.kind === "call");
}

/** Position P&L when every option leg has settled at `price`. */
export function payoffAtExpiry(legs: readonly Leg[], price: number): number {
  let pnl = 0;
  for (const leg of legs) pnl += sideSign(leg) * leg.quantity * (legValueAtExpiry(leg, price) - leg.price);
  return pnl;
}

/** Position P&L at the instant `atMs` for an underlying price, re-pricing unexpired legs with Black-76. */
export function payoffAtDate(
  legs: readonly Leg[],
  price: number,
  atMs: number,
  ivShift = 0,
  opts: ValuationOptions = {},
): number {
  assertPrice(price);
  return preparedPnl(prepare(legs, atMs, ivShift, opts), price);
}

/** Net position greeks at the instant `atMs` for an underlying price (HC-WS-089). Units as in black76.ts. */
export function positionGreeksAt(
  legs: readonly Leg[],
  price: number,
  atMs: number,
  ivShift = 0,
  opts: ValuationOptions = {},
): NetGreeks {
  assertPrice(price);
  return preparedGreeks(prepare(legs, atMs, ivShift, opts), price);
}

/** Net premium: positive when the position was opened for a credit, negative for a debit. Futures carry none. */
export function netPremium(legs: readonly Leg[]): number {
  let premium = 0;
  for (const leg of legs) {
    if (leg.kind !== "future") premium -= sideSign(leg) * leg.quantity * leg.price;
  }
  return premium;
}

function optionStrikes(legs: readonly Leg[]): number[] {
  const set = new Set<number>();
  for (const leg of legs) {
    if (leg.kind !== "future") set.add(leg.strike);
  }
  return [...set].sort((x, y) => x - y);
}

/** Slope of the expiry payoff above the highest strike (calls and futures contribute their signed size). */
function slopeAbove(legs: readonly Leg[]): number {
  let slope = 0;
  for (const leg of legs) {
    if (leg.kind !== "put") slope += sideSign(leg) * leg.quantity;
  }
  return slope;
}

/**
 * Exact extremes of the piecewise-linear expiry payoff: candidates are price 0 and every strike; the ray above
 * the top strike makes the profit (loss) unbounded when its slope is positive (negative).
 */
export function expiryExtremes(legs: readonly Leg[]): { maxProfit: number; maxLoss: number } {
  const candidates = [0, ...optionStrikes(legs)];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const price of candidates) {
    const pnl = payoffAtExpiry(legs, price);
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;
  }
  const slope = slopeAbove(legs);
  if (slope > 0) maxProfit = Infinity;
  if (slope < 0) maxLoss = -Infinity;
  return { maxProfit, maxLoss };
}

/** Prices (> 0, ascending, de-duplicated) where the expiry payoff crosses or touches zero. */
export function breakevens(legs: readonly Leg[]): number[] {
  const nodes = [0, ...optionStrikes(legs)];
  const found: number[] = [];
  let prevPrice = 0;
  let prevPnl = payoffAtExpiry(legs, 0);
  for (let i = 1; i < nodes.length; i++) {
    const price = nodes[i] as number;
    const pnl = payoffAtExpiry(legs, price);
    if (prevPnl === 0) found.push(prevPrice);
    else if (prevPnl * pnl < 0) found.push(prevPrice + ((price - prevPrice) * prevPnl) / (prevPnl - pnl));
    prevPrice = price;
    prevPnl = pnl;
  }
  const slope = slopeAbove(legs);
  if (prevPnl === 0) found.push(prevPrice);
  else if (prevPnl * slope < 0) found.push(prevPrice - prevPnl / slope);

  const out: number[] = [];
  for (const be of found.sort((x, y) => x - y)) {
    const last = out[out.length - 1];
    if (be > 0 && (last === undefined || be - last > 1e-9 * Math.max(1, be))) out.push(be);
  }
  return out;
}

/**
 * Probability that the expiry payoff is positive when the underlying at time T is lognormal with median `spot`
 * (zero drift, sigma = ATM IV), i.e. P(S_T < x) = N((ln(x / spot) + sigma² T / 2) / (sigma sqrt T)).
 * With `T <= 0` or `sigma <= 0` the outcome is certain: 1 if the payoff at `spot` is positive, else 0.
 */
export function probabilityOfProfit(legs: readonly Leg[], spot: number, sigma: number, T: number): number {
  if (Number.isNaN(sigma) || Number.isNaN(T)) return NaN;
  if (T <= 0 || sigma <= 0) return payoffAtExpiry(legs, spot) > 0 ? 1 : 0;
  const sq = sigma * Math.sqrt(T);
  const cdf = (x: number): number => normalCdf((Math.log(x / spot) + 0.5 * sq * sq) / sq);
  const bounds = [0, ...breakevens(legs), Infinity];
  let pop = 0;
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1] as number;
    const b = bounds[i] as number;
    const probe = b === Infinity ? a + Math.max(a, 1) : 0.5 * (a + b);
    if (payoffAtExpiry(legs, probe) > 0) {
      pop += (b === Infinity ? 1 : cdf(b)) - (a === 0 ? 0 : cdf(a));
    }
  }
  return Math.min(1, Math.max(0, pop));
}

/** Reward-to-risk ratio from the expiry extremes (see AnalyzeResult.rewardRisk). */
export function rewardRisk(maxProfit: number, maxLoss: number): number {
  if (maxProfit === Infinity && maxLoss === -Infinity) return NaN;
  if (maxProfit === Infinity) return Infinity;
  if (maxLoss === -Infinity) return 0;
  if (maxLoss >= 0) return maxProfit > 0 ? Infinity : 0;
  return maxProfit / -maxLoss;
}

function nearestExpiryYears(legs: readonly Leg[], nowMs: number, hour: number): number {
  let nearest = NaN;
  for (const leg of legs) {
    if (leg.kind === "future") continue;
    const T = yearFraction(nowMs, leg.expiry, hour);
    if (Number.isNaN(nearest) || T < nearest) nearest = T;
  }
  return nearest;
}

function nearestStrikeIv(legs: readonly Leg[], spot: number): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const leg of legs) {
    if (leg.kind === "future" || leg.iv === undefined) continue;
    const distance = Math.abs(leg.strike - spot);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = leg.iv;
    }
  }
  return best;
}

function defaultPriceRange(legs: readonly Leg[], spot: number): [number, number] {
  const strikes = optionStrikes(legs);
  let lo = spot * 0.8;
  let hi = spot * 1.2;
  if (strikes.length > 0) {
    lo = Math.min(lo, Math.min(...strikes) * 0.95);
    hi = Math.max(hi, Math.max(...strikes) * 1.05);
  }
  return [lo, hi];
}

/** Full strategy analytics for the payoff panel, summary tiles and analytics strip. */
export function analyze(legs: readonly Leg[], opts: AnalyzeOptions): AnalyzeResult {
  const {
    spot,
    nowMs,
    targetDays = 0,
    targetSpot = spot,
    ivShift = 0,
    points = 161,
    defaultIv,
    settlementHourUtc = DEFAULT_SETTLEMENT_HOUR_UTC,
  } = opts;
  assertPrice(spot);
  if (!Number.isFinite(nowMs)) throw new RangeError(`nowMs must be a finite epoch time, got ${nowMs}`);
  if (!Number.isInteger(points) || points < 2) throw new RangeError(`points must be an integer >= 2, got ${points}`);
  const [lo, hi] = opts.priceRange ?? defaultPriceRange(legs, spot);
  if (!(lo > 0) || !(hi > lo)) throw new RangeError(`priceRange must satisfy 0 < lo < hi, got [${lo}, ${hi}]`);

  const valuation: ValuationOptions = { defaultIv, settlementHourUtc };
  const targetMs = nowMs + targetDays * MS_PER_DAY;
  const atTarget = prepare(legs, targetMs, ivShift, valuation);
  const pointAt = (price: number): PayoffPoint => ({
    price,
    pnlExpiry: payoffAtExpiry(legs, price),
    pnlTarget: preparedPnl(atTarget, price),
  });
  const pts: PayoffPoint[] = [];
  for (let i = 0; i < points; i++) pts.push(pointAt(lo + ((hi - lo) * i) / (points - 1)));

  const nearestT = nearestExpiryYears(legs, nowMs, settlementHourUtc);
  const atmIv = opts.atmIv ?? nearestStrikeIv(legs, spot) ?? defaultIv ?? NaN;
  const hasIv = !Number.isNaN(atmIv) && !Number.isNaN(nearestT);
  const { maxProfit, maxLoss } = expiryExtremes(legs);

  return {
    points: pts,
    maxProfit,
    maxLoss,
    breakevens: breakevens(legs),
    netPremium: netPremium(legs),
    pop: hasIv ? probabilityOfProfit(legs, spot, atmIv, nearestT) : NaN,
    greeks: preparedGreeks(prepare(legs, nowMs, ivShift, valuation), spot),
    expectedMove: hasIv ? spot * atmIv * Math.sqrt(Math.max(nearestT, 0)) : NaN,
    rewardRisk: rewardRisk(maxProfit, maxLoss),
    target: pointAt(targetSpot),
    targetMs,
    daysToNearestExpiry: nearestT * DAYS_PER_YEAR,
    atmIv,
  };
}

/** Price × date matrix of position P&L, delta or theta (HC-WS-062, HC-WS-089, HC-WS-090). */
export function scenarioGrid(legs: readonly Leg[], opts: ScenarioOptions): ScenarioGrid {
  const { prices, dates, ivShift = 0, mode = "pnl" } = opts;
  for (const price of prices) assertPrice(price);
  const values = dates.map((atMs) => {
    const prepared = prepare(legs, atMs, ivShift, opts);
    return prices.map((price) => {
      if (mode === "pnl") return preparedPnl(prepared, price);
      const g = preparedGreeks(prepared, price);
      return mode === "delta" ? g.delta : g.theta;
    });
  });
  return { prices: [...prices], dates: [...dates], mode, values };
}

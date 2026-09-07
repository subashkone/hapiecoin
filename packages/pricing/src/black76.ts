/**
 * Black-76 option pricing on a forward F (Black, 1976). Delta Exchange India marks its options with the spot
 * price as the forward and zero rate (verified in `validation.test.ts`: the forward implied by every fixture
 * mark equals the ticker's spot to within spot-sampling skew, flat across tenors), so callers pass `r = 0`.
 *
 * Conventions (match the Delta ticker `greeks` block, see validation test):
 * - `delta` per one underlying unit; `gamma` delta change per 1 USD move
 * - `theta` in USD per one calendar day (365-day year)
 * - `vega` in USD per 1 vol point (a 0.01 change in sigma)
 * - `rho` in USD per 1 percentage point of the rate, Black-76 definition (-T × price × 0.01). Delta reports a
 *   spot-model (Black-Scholes) rho instead; it is not compared.
 */

import { normalCdf, normalPdf } from "./normal.js";

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface ImpliedVolOptions {
  /** Lower bracket for sigma (default 0.01). Results are clamped to [lo, hi]. */
  lo?: number | undefined;
  /** Upper bracket for sigma (default 5). */
  hi?: number | undefined;
  /** Convergence tolerance on sigma (default 1e-8). */
  tol?: number | undefined;
  /** Continuously compounded rate (default 0). */
  r?: number | undefined;
  /** Iteration cap (default 100; bisection alone needs about 30 for tol 1e-8 on [0.01, 5]). */
  maxIter?: number | undefined;
}

const DAYS_PER_YEAR = 365;

/** Undiscounted intrinsic value max(F - K, 0) or max(K - F, 0). */
export function intrinsicValue(F: number, K: number, isCall: boolean): number {
  return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
}

function validInputs(F: number, K: number, T: number, sigma: number, r: number): boolean {
  return F > 0 && K > 0 && Number.isFinite(F) && Number.isFinite(K) && Number.isFinite(T) && Number.isFinite(sigma) && Number.isFinite(r);
}

/**
 * Black-76 price. Returns the intrinsic value when `T <= 0` (settled) and the discounted intrinsic value when
 * `sigma <= 0` (deterministic forward). Returns NaN for invalid inputs (F or K not positive, non-finite T/sigma/r).
 */
export function black76Price(F: number, K: number, T: number, sigma: number, isCall: boolean, r = 0): number {
  if (!validInputs(F, K, T, sigma, r)) return NaN;
  if (T <= 0) return intrinsicValue(F, K, isCall);
  const df = Math.exp(-r * T);
  if (sigma <= 0) return df * intrinsicValue(F, K, isCall);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sq * sq) / sq;
  const d2 = d1 - sq;
  return isCall ? df * (F * normalCdf(d1) - K * normalCdf(d2)) : df * (K * normalCdf(-d2) - F * normalCdf(-d1));
}

/** Vega per 1.0 of sigma (internal; the public greek is per vol point). */
function rawVega(F: number, K: number, T: number, sigma: number, r: number): number {
  const sqT = Math.sqrt(T);
  const sq = sigma * sqT;
  const d1 = (Math.log(F / K) + 0.5 * sq * sq) / sq;
  return Math.exp(-r * T) * F * normalPdf(d1) * sqT;
}

/**
 * Black-76 greeks (see the module header for units). At or after settlement (`T <= 0`), or with `sigma <= 0`,
 * delta is the discounted moneyness indicator (call: 1 in the money, 0.5 at the money, 0 out; put: -1 / -0.5 / 0)
 * and every other greek is 0. Invalid inputs give NaN for every field.
 */
export function black76Greeks(F: number, K: number, T: number, sigma: number, isCall: boolean, r = 0): Greeks {
  if (!validInputs(F, K, T, sigma, r)) {
    return { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN };
  }
  const Tpos = Math.max(T, 0);
  const df = Math.exp(-r * Tpos);
  if (T <= 0 || sigma <= 0) {
    const inTheMoney = isCall ? F > K : F < K;
    const indicator = inTheMoney ? 1 : F === K ? 0.5 : 0;
    return { delta: df * (isCall ? indicator : -indicator), gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqT = Math.sqrt(T);
  const sq = sigma * sqT;
  const d1 = (Math.log(F / K) + 0.5 * sq * sq) / sq;
  const d2 = d1 - sq;
  const pdf = normalPdf(d1);
  const nd1 = normalCdf(d1);
  const price = isCall ? df * (F * nd1 - K * normalCdf(d2)) : df * (K * normalCdf(-d2) - F * normalCdf(-d1));
  const delta = df * (isCall ? nd1 : nd1 - 1);
  const gamma = (df * pdf) / (F * sq);
  const vega = df * F * pdf * sqT * 0.01;
  // dV/dT = -r V + df F n(d1) sigma / (2 sqrt T); theta is the calendar decay, -dV/dT, per day.
  const theta = (r * price - (df * F * pdf * sigma) / (2 * sqT)) / DAYS_PER_YEAR;
  const rho = -T * price * 0.01;
  return { delta, gamma, theta, vega, rho };
}

/**
 * Implied volatility by safeguarded Newton-Raphson: every Newton step must land strictly inside the current
 * bracket and vega must be meaningful, otherwise the step is replaced by bisection, so convergence is guaranteed.
 *
 * No-arbitrage bounds (discount factor df = e^(-rT)):
 *   call: df × max(F - K, 0) <= price <= df × F
 *   put:  df × max(K - F, 0) <= price <= df × K
 * Returns NaN only when `price` lies outside those bounds (beyond a 1e-10 relative slack), when `T <= 0`
 * (a settled option carries no volatility information) or when inputs are invalid. A price inside the bounds
 * but below the model price at `lo` (or above it at `hi`) returns the clamped bracket edge.
 */
export function impliedVol(
  price: number,
  F: number,
  K: number,
  T: number,
  isCall: boolean,
  options: ImpliedVolOptions = {},
): number {
  const { lo = 0.01, hi = 5, tol = 1e-8, r = 0, maxIter = 100 } = options;
  if (!validInputs(F, K, T, 1, r) || !Number.isFinite(price) || T <= 0) return NaN;
  const df = Math.exp(-r * T);
  const lower = df * intrinsicValue(F, K, isCall);
  const upper = df * (isCall ? F : K);
  const slack = 1e-10 * upper;
  if (price < lower - slack || price > upper + slack) return NaN;

  let a = lo;
  let b = hi;
  if (black76Price(F, K, T, a, isCall, r) >= price) return a;
  if (black76Price(F, K, T, b, isCall, r) <= price) return b;

  // Brenner-Subrahmanyam seed (exact at the money), pulled inside the bracket.
  let sigma = Math.sqrt((2 * Math.PI) / T) * (price / F);
  if (!(sigma > a && sigma < b)) sigma = 0.5 * (a + b);

  for (let i = 0; i < maxIter; i++) {
    const f = black76Price(F, K, T, sigma, isCall, r) - price;
    if (f === 0) return sigma;
    if (f > 0) b = sigma;
    else a = sigma;
    const v = rawVega(F, K, T, sigma, r);
    let next = sigma - f / v;
    if (!(v > 1e-12) || !Number.isFinite(next) || next <= a || next >= b) next = 0.5 * (a + b);
    if (Math.abs(next - sigma) < tol) return next;
    sigma = next;
  }
  return sigma;
}

/**
 * Black-Scholes-Merton on a spot with a continuous rate `r` and carry (dividend or foreign-rate) yield `q`
 * (ADR-066): the forward is F = S · e^{(r − q) T} and the option is Black-76 on that forward, discounted at r.
 * With r = q = 0 the forward is S · 1, so every result equals the Black-76 result to the bit, which is what
 * the apps get today (Delta India quotes marks on spot with no carry). Delta and gamma are reported per unit
 * of spot (dF/dS = e^{(r − q) T}); theta is the calendar decay at a fixed spot, so it carries the drift of the
 * forward, −(r − q) F ∂V/∂F, on top of the forward model's decay (per 365-day calendar day like black76.ts,
 * whatever the trading calendar's day count); vega is the forward model's; rho stays the forward-price rho of
 * black76.ts.
 */
import { type Greeks, type ImpliedVolOptions, black76Greeks, black76Price, impliedVol } from "./black76.js";
import { DAYS_PER_YEAR } from "./time.js";

/** The forward implied by a spot under a rate and a carry yield; NaN for invalid inputs. */
export function forwardPrice(S: number, T: number, r = 0, q = 0): number {
  if (!(S > 0) || !Number.isFinite(S) || !Number.isFinite(T) || !Number.isFinite(r) || !Number.isFinite(q)) return NaN;
  return S * Math.exp((r - q) * Math.max(T, 0));
}

/** BSM price on spot `S`; intrinsic once settled, NaN for invalid inputs. */
export function bsmPrice(S: number, K: number, T: number, sigma: number, isCall: boolean, r = 0, q = 0): number {
  const F = forwardPrice(S, T, r, q);
  if (Number.isNaN(F)) return NaN;
  return black76Price(F, K, T, sigma, isCall, r);
}

/** BSM greeks per unit of spot: delta and gamma carry dF/dS, theta carries the forward drift, vega and rho are the forward model's. */
export function bsmGreeks(S: number, K: number, T: number, sigma: number, isCall: boolean, r = 0, q = 0): Greeks {
  const F = forwardPrice(S, T, r, q);
  if (Number.isNaN(F)) return { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN };
  const g = black76Greeks(F, K, T, sigma, isCall, r);
  const growth = F / S;
  // dV/dt at fixed S = dV/dt at fixed F + (dV/dF)(dF/dt), and dF/dt = -(r - q) F; exactly 0 without a rate and carry
  const drift = r === 0 && q === 0 ? 0 : -((r - q) * F * g.delta) / DAYS_PER_YEAR;
  return { delta: g.delta * growth, gamma: g.gamma * growth * growth, theta: g.theta + drift, vega: g.vega, rho: g.rho };
}

export interface BsmImpliedVolOptions extends ImpliedVolOptions {
  /** Carry (dividend or foreign-rate) yield, continuous; default 0. */
  q?: number | undefined;
}

/** Implied volatility of a spot-quoted option price under r and q; NaN when no volatility reproduces it. */
export function bsmImpliedVol(price: number, S: number, K: number, T: number, isCall: boolean, options: BsmImpliedVolOptions = {}): number {
  const { q = 0, ...rest } = options;
  const F = forwardPrice(S, T, rest.r ?? 0, q);
  if (Number.isNaN(F)) return NaN;
  return impliedVol(price, F, K, T, isCall, rest);
}

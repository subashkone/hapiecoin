// Deterministic market history for the mock API (ADR-056): a year of front-expiry ATM IV and spot per underlying,
// and 24 h of five-minute marks per option symbol. Mirrors apps/api/src/market-history.ts shapes.
import { type IvHistory, type IvPoint, type MarkHistory, type Underlying, ivRankOf, realisedVolOf } from "@hapiecoin/schema";

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const BASE: Record<Underlying, { spot: number; iv: number; seed: number }> = { BTC: { spot: 79_521, iv: 0.42, seed: 11 }, ETH: { spot: 4_012, iv: 0.55, seed: 23 }, XAUT: { spot: 3_640, iv: 0.16, seed: 37 } };

/** 365 daily points ending yesterday, a random walk around the base with the last point at today's base. */
export function mockIvHistory(asset: Underlying, days = 365, today = new Date()): IvHistory {
  const base = BASE[asset];
  const r = rng(base.seed);
  const series: IvPoint[] = [];
  let iv = base.iv * 0.8;
  let spot = base.spot * 0.85;
  const expiry = new Date(today.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
  for (let i = days - 1; i >= 0; i--) {
    iv = Math.max(0.12, Math.min(1.2, iv + (r() - 0.5) * 0.03 + (base.iv - iv) * 0.02));
    spot = Math.max(1, spot * (1 + (r() - 0.5) * 0.03 + (base.spot - spot) * 0.0003 / base.spot));
    const day = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day, atmIv: Number(iv.toFixed(4)), spot: Number(spot.toFixed(1)), expiry });
  }
  const last = series.at(-1)!;
  const current = { atmIv: last.atmIv, spot: last.spot, expiry, ts: today.toISOString() };
  const rank = ivRankOf(series.map((p) => p.atmIv), current.atmIv);
  const rv = realisedVolOf(series.slice(-30).map((p) => p.spot));
  return {
    asset,
    asOf: today.toISOString(),
    current,
    rank,
    realised: rv ? { rv30: rv.rv, days: rv.days, spread: current.atmIv - rv.rv } : null,
    spot24h: { high: last.spot * 1.012, low: last.spot * 0.991 },
    series,
  };
}

/** 24 h of five-minute marks for one symbol: a drift with noise, IV wandering around 0.42. */
export function mockMarkHistory(symbol: string, hours = 24, now = new Date()): MarkHistory {
  let seed = 7;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const points: MarkHistory["points"] = [];
  const n = hours * 12;
  let mark = 800 + r() * 2_000;
  let iv = 0.38 + r() * 0.1;
  for (let i = n; i >= 0; i--) {
    mark = Math.max(1, mark * (1 + (r() - 0.5) * 0.01));
    iv = Math.max(0.1, iv + (r() - 0.5) * 0.004);
    points.push({ ts: new Date(now.getTime() - i * 300_000).toISOString(), mark: Number(mark.toFixed(1)), markIv: Number(iv.toFixed(4)) });
  }
  return { symbol, hours, points };
}

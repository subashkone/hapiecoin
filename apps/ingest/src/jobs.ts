/**
 * Dataset builders: each turns adapter calls into one validated Snapshot envelope. A venue that fails is left out
 * of that refresh (its absence shows in `source`), so one exchange's outage never blanks a chart; the job fails
 * only when no venue answered. Aggregation is stated in `source` as "Binance · Bybit · OKX" (ADR-038).
 */
import { ANALYTICS_VENUE_LABELS, type AnalyticsSnapshot, type AnalyticsVenue, AnalyticsSnapshot as SnapshotSchema, type FundingData, type OpenInterestData, type SeriesPoint, analyticsKey, fundingApr } from "@hapiecoin/schema";
import type { BinanceAdapter, RatioPoint } from "./adapters/binance.js";
import type { BybitAdapter } from "./adapters/bybit.js";
import type { CoinGeckoAdapter } from "./adapters/coingecko.js";
import type { FearGreedAdapter } from "./adapters/feargreed.js";
import type { OkxAdapter } from "./adapters/okx.js";
import type { LiquidationBuffer } from "./liquidations.js";

export interface Adapters {
  binance: BinanceAdapter;
  bybit: BybitAdapter;
  okx: OkxAdapter;
  coingecko: CoinGeckoAdapter | null;
  fearGreed: FearGreedAdapter;
}

export class NoVenueError extends Error {
  constructor(dataset: string, readonly causes: readonly Error[]) {
    super(`${dataset}: every venue failed (${causes.map((c) => c.message).join(" | ")})`);
    this.name = "NoVenueError";
  }
}

type Settled<T> = { venue: AnalyticsVenue; value: T } | { venue: AnalyticsVenue; error: Error };
async function settle<T>(venue: AnalyticsVenue, p: Promise<T>): Promise<Settled<T>> {
  try {
    return { venue, value: await p };
  } catch (error) {
    return { venue, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
function split<T>(results: Settled<T>[]): { ok: { venue: AnalyticsVenue; value: T }[]; errors: Error[] } {
  const ok: { venue: AnalyticsVenue; value: T }[] = [];
  const errors: Error[] = [];
  for (const r of results) {
    if ("value" in r) ok.push(r);
    else errors.push(r.error);
  }
  return { ok, errors };
}
const sourceOf = (venues: readonly AnalyticsVenue[]): string => venues.map((v) => ANALYTICS_VENUE_LABELS[v]).join(" · ");

/** Sum per-venue series on a shared time grid (points bucketed to `stepMs`); venues missing a bucket contribute their last value. */
export function sumSeries(series: readonly { points: readonly SeriesPoint[] }[], stepMs: number): SeriesPoint[] {
  const grid = new Map<number, number[]>();
  series.forEach((s, i) => {
    for (const p of s.points) {
      const t = Math.floor(p.t / stepMs) * stepMs;
      const row = grid.get(t) ?? new Array<number>(series.length).fill(NaN);
      row[i] = p.v;
      grid.set(t, row);
    }
  });
  const last = new Array<number>(series.length).fill(0);
  return [...grid.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, row]) => {
      row.forEach((v, i) => {
        if (Number.isFinite(v)) last[i] = v;
      });
      return { t, v: last.reduce((s, v) => s + v, 0) };
    });
}

/** Weighted mean per bucket: Σ(rate × weight) / Σ weight over the venues present in that bucket. */
export function weightedSeries(series: readonly { points: readonly SeriesPoint[]; weight: number }[], stepMs: number): SeriesPoint[] {
  const grid = new Map<number, { num: number; den: number }>();
  for (const s of series) {
    for (const p of s.points) {
      const t = Math.floor(p.t / stepMs) * stepMs;
      const acc = grid.get(t) ?? { num: 0, den: 0 };
      acc.num += p.v * s.weight;
      acc.den += s.weight;
      grid.set(t, acc);
    }
  }
  return [...grid.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, { num, den }]) => ({ t, v: den > 0 ? num / den : 0 }));
}

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export interface JobContext {
  adapters: Adapters;
  now: () => number;
  ttlMs: number;
}

function finish(snapshot: AnalyticsSnapshot): AnalyticsSnapshot {
  const out = SnapshotSchema.safeParse(snapshot);
  if (!out.success) throw new Error(`snapshot ${snapshot.key} failed validation: ${out.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return out.data;
}

export async function buildFunding(ctx: JobContext, symbol: string): Promise<AnalyticsSnapshot> {
  const a = ctx.adapters;
  const results = await Promise.all([
    settle("binance", Promise.all([a.binance.funding(symbol), a.binance.openInterest(symbol, "5m", 1)]).then(([f, oi]) => ({ rate: f.rate, predicted: null, nextFundingAt: f.nextFundingAt, oiUsd: oi.oiUsd, history: f.history }))),
    settle("bybit", Promise.all([a.bybit.ticker(symbol), a.bybit.fundingHistory(symbol)]).then(([t, h]) => ({ rate: t.rate, predicted: null, nextFundingAt: t.nextFundingAt, oiUsd: t.oiUsd, history: h }))),
    settle("okx", Promise.all([a.okx.funding(symbol), a.okx.openInterest(symbol)]).then(([f, oi]) => ({ rate: f.rate, predicted: f.predicted, nextFundingAt: f.nextFundingAt, oiUsd: oi.oiUsd, history: f.history }))),
  ]);
  const { ok, errors } = split(results);
  if (ok.length === 0) throw new NoVenueError("funding", errors);
  const data: FundingData = {
    symbol: symbol.toUpperCase(),
    venues: ok.map(({ venue, value }) => ({ venue, rate: value.rate, predicted: value.predicted, nextFundingAt: value.nextFundingAt, apr: fundingApr(value.rate), oiUsd: value.oiUsd })),
    history: ok.map(({ venue, value }) => ({ venue, points: value.history })),
    oiWeighted: weightedSeries(
      ok.map(({ value }) => ({ points: value.history, weight: value.oiUsd > 0 ? value.oiUsd : 1 })),
      EIGHT_HOURS,
    ),
  };
  return finish({ dataset: "funding", key: analyticsKey("funding", symbol), source: sourceOf(ok.map((r) => r.venue)), asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false, data });
}

export async function buildOpenInterest(ctx: JobContext, symbol: string): Promise<AnalyticsSnapshot> {
  const a = ctx.adapters;
  const results = await Promise.all([
    settle("binance", a.binance.openInterest(symbol).then((oi) => ({ oiUsd: oi.oiUsd, oiBase: oi.oiBase, history: oi.history }))),
    settle("bybit", Promise.all([a.bybit.ticker(symbol), a.bybit.openInterestHistory(symbol)]).then(([t, h]) => ({ oiUsd: t.oiUsd, oiBase: t.oiBase, history: h.map((p) => ({ t: p.t, v: p.v * t.lastPrice })) }))),
    settle("okx", a.okx.openInterest(symbol).then((oi) => ({ oiUsd: oi.oiUsd, oiBase: oi.oiBase, history: oi.history }))),
  ]);
  const { ok, errors } = split(results);
  if (ok.length === 0) throw new NoVenueError("open-interest", errors);
  const change = (history: SeriesPoint[], nowUsd: number, backMs: number): number | null => {
    const cutoff = ctx.now() - backMs;
    const past = [...history].reverse().find((p) => p.t <= cutoff);
    return past && past.v > 0 ? nowUsd / past.v - 1 : null;
  };
  const data: OpenInterestData = {
    symbol: symbol.toUpperCase(),
    venues: ok.map(({ venue, value }) => ({ venue, oiUsd: value.oiUsd, oiBase: value.oiBase, change1h: change(value.history, value.oiUsd, HOUR), change24h: change(value.history, value.oiUsd, 24 * HOUR) })),
    totalUsd: ok.reduce((s, r) => s + r.value.oiUsd, 0),
    history: ok.map(({ venue, value }) => ({ venue, points: value.history })),
    aggregated: sumSeries(
      ok.map(({ value }) => ({ points: value.history })),
      FIVE_MIN,
    ),
  };
  return finish({ dataset: "open-interest", key: analyticsKey("open-interest", symbol), source: sourceOf(ok.map((r) => r.venue)), asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false, data });
}

const latestOf = (pts: RatioPoint[]): { long: number; short: number; ratio: number } => {
  const l = pts[pts.length - 1];
  return l ? { long: l.long, short: l.short, ratio: l.ratio } : { long: 0, short: 0, ratio: 0 };
};

const ratioSeries = (pts: RatioPoint[]): SeriesPoint[] => pts.map((p) => ({ t: p.t, v: p.ratio }));

/**
 * Long/short comes from Binance (the only venue publishing all three series the chart needs); when Binance cannot be
 * reached the global account ratio comes from Bybit and the top-trader series stay empty (ADR-041, GAPS #57).
 */
export async function buildLongShort(ctx: JobContext, symbol: string): Promise<AnalyticsSnapshot> {
  const b = ctx.adapters.binance;
  const primary = await settle("binance", Promise.all([b.globalLongShort(symbol), b.topAccountsLongShort(symbol), b.topPositionsLongShort(symbol)]));
  const base = { dataset: "long-short" as const, key: analyticsKey("long-short", symbol), asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false };
  if ("value" in primary) {
    const [global, topAccounts, topPositions] = primary.value;
    return finish({
      ...base,
      source: "Binance",
      data: { symbol: symbol.toUpperCase(), venue: "binance", period: "1h", global: ratioSeries(global), topAccounts: ratioSeries(topAccounts), topPositions: ratioSeries(topPositions), latest: { global: latestOf(global), topAccounts: latestOf(topAccounts), topPositions: latestOf(topPositions) } },
    });
  }
  const fallback = await settle("bybit", ctx.adapters.bybit.accountRatio(symbol));
  if ("error" in fallback) throw new NoVenueError("long-short", [primary.error, fallback.error]);
  return finish({
    ...base,
    source: "Bybit",
    data: { symbol: symbol.toUpperCase(), venue: "bybit", period: "1h", global: ratioSeries(fallback.value), topAccounts: [], topPositions: [], latest: { global: latestOf(fallback.value), topAccounts: latestOf([]), topPositions: latestOf([]) } },
  });
}

export async function buildTakerVolume(ctx: JobContext, symbol: string): Promise<AnalyticsSnapshot> {
  const points = await ctx.adapters.binance.takerVolume(symbol);
  return finish({ dataset: "taker-volume", key: analyticsKey("taker-volume", symbol), source: "Binance", asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false, data: { symbol: symbol.toUpperCase(), venue: "binance", period: "1h", points } });
}

export async function buildMarkets(ctx: JobContext): Promise<AnalyticsSnapshot> {
  if (!ctx.adapters.coingecko) throw new Error("markets: COINGECKO_API_KEY not set");
  const data = await ctx.adapters.coingecko.markets();
  return finish({ dataset: "markets", key: analyticsKey("markets"), source: "CoinGecko", asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false, data });
}

export async function buildFearGreed(ctx: JobContext): Promise<AnalyticsSnapshot> {
  const data = await ctx.adapters.fearGreed.history();
  return finish({ dataset: "fear-greed", key: analyticsKey("fear-greed"), source: "alternative.me", asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: false, data });
}

/** Polls OKX's recent liquidations for every tracked symbol into the buffer, then folds the buffer (with the Binance and Bybit streams' events) into the snapshot. */
export async function buildLiquidations(ctx: JobContext, symbols: readonly string[], buffer: LiquidationBuffer, streams: { binance?: boolean; bybit?: boolean }): Promise<AnalyticsSnapshot> {
  const results = await Promise.all(symbols.map((s) => settle("okx", ctx.adapters.okx.liquidations(s))));
  const { ok } = split(results);
  for (const r of ok) buffer.add(r.value);
  const venues: AnalyticsVenue[] = [];
  if (streams.binance) venues.push("binance");
  if (streams.bybit) venues.push("bybit");
  if (ok.length > 0) venues.push("okx");
  return finish({ dataset: "liquidations", key: analyticsKey("liquidations"), source: venues.length ? sourceOf(venues) : "no venue connected", asOf: ctx.now(), ttlMs: ctx.ttlMs, stale: venues.length === 0, data: buffer.snapshot() });
}

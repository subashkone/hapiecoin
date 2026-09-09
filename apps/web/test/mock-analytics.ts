// Deterministic analytics snapshots for unit tests and Playwright (ADR-038): the same shapes the ingest service
// writes, generated from a seeded random walk so charts and tables have realistic, stable data.
import { type AnalyticsDataset, type AnalyticsSnapshot, type CycleData, type FundingData, type OptionsData, type PremiumData, type RsiData, type LiquidationEvent, type LiquidationsData, type LongShortData, type MarketRow, type OpenInterestData, type OverviewData, type SeriesPoint, type TakerVolumeData, RAINBOW_MULTIPLIERS, RAINBOW_NAMES, RSI_TIMEFRAMES, analyticsKey, fearGreedLabel, fundingApr, logLinearFit, maxPain, sma } from "@hapiecoin/schema";

/** Snapshot time: the current minute, so windowed views (1h liquidations, 12h heatmap) hold real events; values stay seeded. */
const NOW = Math.floor(Date.now() / 60e3) * 60e3;
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function walk(seed: number, n: number, stepMs: number, start: number, vol: number, min = 0): SeriesPoint[] {
  const r = rng(seed);
  const out: SeriesPoint[] = [];
  let v = start;
  for (let i = n - 1; i >= 0; i--) {
    out.push({ t: NOW - i * stepMs, v: Math.max(min, v) });
    v = v * (1 + (r() - 0.5) * vol);
  }
  return out;
}
const COINS: [string, string, number, number][] = [["BTC", "Bitcoin", 80_000, 1.6e12], ["ETH", "Ethereum", 3_000, 3.6e11], ["SOL", "Solana", 150, 7e10], ["XRP", "XRP", 0.55, 3e10], ["BNB", "BNB", 600, 8.7e10], ["DOGE", "Dogecoin", 0.12, 1.7e10], ["ADA", "Cardano", 0.4, 1.4e10], ["AVAX", "Avalanche", 30, 1.2e10], ["LINK", "Chainlink", 14, 8e9], ["LTC", "Litecoin", 70, 5e9]];

export function mockMarketRows(): MarketRow[] {
  return COINS.map(([symbol, name, price, cap], i) => {
    const r = rng(100 + i);
    const c24 = (r() - 0.45) * 8;
    return { rank: i + 1, symbol, name, price, change1h: (r() - 0.5) * 1.5, change24h: Number(c24.toFixed(2)), change7d: (r() - 0.4) * 20, marketCap: cap, volume24h: cap * 0.03, sparkline7d: walk(200 + i, 40, 4.2 * 3600e3, price, 0.02).map((p) => p.v) };
  });
}

function envelope<D extends AnalyticsDataset>(dataset: D, key: string, source: string, data: Extract<AnalyticsSnapshot, { dataset: D }>["data"], ttlMs = 60_000): AnalyticsSnapshot {
  return { dataset, key, source, asOf: NOW - 20_000, ttlMs, stale: false, data } as AnalyticsSnapshot;
}

export function mockOverview(): OverviewData {
  const rows = mockMarketRows();
  const symbols = COINS.map(([symbol], i) => {
    const r = rng(300 + i);
    const oiUsd = [8.4e9, 3.1e9, 9e8, 6e8, 5e8, 4e8, 3e8, 2.5e8, 2e8, 1.5e8][i]!;
    return { symbol, oiUsd, oiChange1h: (r() - 0.5) * 0.02, oiChange24h: (r() - 0.45) * 0.1, funding: (r() - 0.4) * 0.0003, lsRatio: 0.8 + r() * 0.8, liq24hUsd: oiUsd * 0.02, venues: 3 };
  });
  const totalOiUsd = symbols.reduce((s, x) => s + x.oiUsd, 0);
  const oiHistory = walk(1, 288, 5 * 60e3, totalOiUsd * 0.97, 0.004);
  const fg = walk(2, 365, 864e5, 50, 0.08, 1).map((p) => ({ t: p.t, v: Math.max(0, Math.min(100, Math.round(p.v))) }));
  const fgNow = fg[fg.length - 1]!;
  const byChange = [...rows].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
  return {
    symbols,
    totalOiUsd,
    oiChange24h: 0.0234,
    liquidations24h: { longUsd: 1.987e8, shortUsd: 2.4e7 },
    fearGreed: { value: fgNow.v, label: fearGreedLabel(fgNow.v), at: fgNow.t },
    btcLongShort: { long: 0.5263, short: 0.4737, ratio: 1.11 },
    markets: { btcPrice: 80_000, btcChange24h: rows[0]!.change24h, ethPrice: 3_000, ethChange24h: rows[1]!.change24h, btcDominance: 55.1, ethDominance: 12.4, totalMarketCap: 2.9e12, volume24h: 9e10, gainers: byChange.slice(0, 8), losers: byChange.slice(-8).reverse(), heatmap: rows.map((r) => ({ symbol: r.symbol, marketCap: r.marketCap ?? 0, change24h: r.change24h })) },
    oiHistory,
    lsHistory: walk(3, 168, 3600e3, 1.1, 0.03, 0.3),
    fearGreedHistory: fg,
  };
}

const VENUES = ["binance", "bybit", "okx"] as const;
const coinIndex = (symbol: string) => Math.max(0, COINS.findIndex(([s]) => s === symbol));
const OI_USD = [8.4e9, 3.1e9, 9e8, 6e8, 5e8, 4e8, 3e8, 2.5e8, 2e8, 1.5e8];

/** Funding per venue with 8 h history and the OI-weighted series (PR 5.3 pages). */
export function mockFunding(symbol: string): FundingData {
  const i = coinIndex(symbol);
  const r = rng(400 + i);
  const oi = OI_USD[i]!;
  const base = (r() - 0.4) * 0.0003;
  const venues = VENUES.map((venue, k) => {
    const rate = Number((base + (k - 1) * 0.00004).toFixed(6));
    return { venue, rate, predicted: Number((rate * 1.05).toFixed(6)), nextFundingAt: Math.ceil(NOW / 288e5) * 288e5, apr: fundingApr(rate), oiUsd: oi * [0.55, 0.3, 0.15][k]! };
  });
  const history = VENUES.map((venue, k) => ({ venue, points: walk(500 + i * 3 + k, 90, 288e5, 0.0001 + k * 0.00002, 0.3, -0.001).map((p) => ({ t: p.t, v: Number((p.v - 0.00005).toFixed(6)) })) }));
  const oiWeighted = history[0]!.points.map((p, j) => ({ t: p.t, v: Number((history.reduce((s, h) => s + (h.points[j]?.v ?? 0), 0) / history.length).toFixed(6)) }));
  return { symbol, venues, history, oiWeighted };
}
export function mockOpenInterest(symbol: string): OpenInterestData {
  const i = coinIndex(symbol);
  const r = rng(600 + i);
  const oi = OI_USD[i]!;
  const shares = [0.55, 0.3, 0.15];
  const venues = VENUES.map((venue, k) => ({ venue, oiUsd: oi * shares[k]!, oiBase: (oi * shares[k]!) / COINS[i]![2], change1h: (r() - 0.5) * 0.02, change24h: (r() - 0.45) * 0.1 }));
  const history = VENUES.map((venue, k) => ({ venue, points: walk(700 + i * 3 + k, 288, 5 * 60e3, oi * shares[k]! * 0.97, 0.004) }));
  const aggregated = history[0]!.points.map((p, j) => ({ t: p.t, v: history.reduce((s, h) => s + (h.points[j]?.v ?? 0), 0) }));
  return { symbol, venues, totalUsd: oi, history, aggregated };
}
export function mockLongShort(symbol: string): LongShortData {
  const i = coinIndex(symbol);
  const mk = (seed: number, start: number) => walk(seed, 168, 3600e3, start, 0.03, 0.3).map((p) => ({ t: p.t, v: Number(p.v.toFixed(2)) }));
  const global = mk(800 + i, 1.1);
  const topAccounts = mk(820 + i, 1.4);
  const topPositions = mk(840 + i, 0.9);
  const latest = (s: SeriesPoint[]) => {
    const ratio = s[s.length - 1]!.v;
    return { long: Number((ratio / (1 + ratio)).toFixed(4)), short: Number((1 / (1 + ratio)).toFixed(4)), ratio };
  };
  return { symbol, venue: "binance", period: "1h", global, topAccounts, topPositions, latest: { global: latest(global), topAccounts: latest(topAccounts), topPositions: latest(topPositions) } };
}
export function mockTakerVolume(symbol: string): TakerVolumeData {
  const i = coinIndex(symbol);
  const r = rng(900 + i);
  const vol = COINS[i]![3] * 0.03;
  const points = walk(950 + i, 168, 3600e3, vol / 24, 0.2).map((p) => {
    const b = 0.4 + r() * 0.25;
    return { t: p.t, buy: p.v * b, sell: p.v * (1 - b) };
  });
  return { symbol, venue: "binance", period: "1h", points };
}
/** 24 h of hourly buckets plus 60 recent events spread over the last 6 h across three venues. */
export function mockLiquidations(): LiquidationsData {
  const r = rng(1100);
  const bucketMs = 3600e3;
  const start = Math.floor((NOW - 24 * 3600e3) / bucketMs) * bucketMs;
  const buckets: LiquidationsData["buckets"] = [];
  for (let t = start; t <= NOW; t += bucketMs) buckets.push({ t, longUsd: 2e6 + r() * 1.4e7, shortUsd: 1e6 + r() * 6e6 });
  const recent: LiquidationEvent[] = [];
  for (let k = 0; k < 60; k++) {
    const c = COINS[Math.floor(r() * COINS.length)]!;
    const side = r() > 0.4 ? "long" : "short";
    const usd = Math.round(800 + Math.pow(r(), 3) * 900_000);
    const priceAt = c[2] * (1 + (side === "long" ? -1 : 1) * r() * 0.03);
    recent.push({ t: NOW - Math.floor(r() * 6 * 3600e3), venue: VENUES[k % 3]!, symbol: c[0], side, price: priceAt, qty: usd / priceAt, usd });
  }
  recent.sort((a, b) => b.t - a.t);
  const bySymbol = COINS.map(([symbol], i) => ({ symbol, longUsd: OI_USD[i]! * 0.016, shortUsd: OI_USD[i]! * 0.004 }));
  const total = bySymbol.reduce((s, x) => ({ longUsd: s.longUsd + x.longUsd, shortUsd: s.shortUsd + x.shortUsd }), { longUsd: 0, shortUsd: 0 });
  const byVenue = VENUES.map((venue, k) => ({ venue, longUsd: total.longUsd * [0.6, 0.25, 0.15][k]!, shortUsd: total.shortUsd * [0.6, 0.25, 0.15][k]! }));
  return { windowMs: 24 * 3600e3, bucketMs, buckets, byVenue, bySymbol, total, recent };
}

/** Options OI per expiry for Deribit and Delta: eight expiries, strikes around the mock price (PR 5.4a). */
export function mockOptions(symbol: string): OptionsData {
  const i = coinIndex(symbol);
  const price = COINS[i]![2];
  const r = rng(1300 + i);
  const venues = (["deribit", "delta"] as const).map((venue, k) => {
    const scale = k === 0 ? 1 : 0.04;
    const expiries = Array.from({ length: 8 }, (_, e) => {
      const expiry = Math.ceil(NOW / 864e5) * 864e5 + [1, 2, 3, 9, 16, 44, 79, 170][e]! * 864e5 + 8 * 3600e3;
      const strikes = Array.from({ length: 9 }, (_, s) => Math.round((price * (0.7 + s * 0.075)) / (price > 1000 ? 1000 : 10)) * (price > 1000 ? 1000 : 10));
      const instruments = strikes.flatMap((strike) => [
        { strike, type: "call" as const, oi: scale * (200 + r() * 2000) * (strike > price ? 1.4 : 0.6) },
        { strike, type: "put" as const, oi: scale * (200 + r() * 1500) * (strike < price ? 1.4 : 0.6) },
      ]);
      const d = new Date(expiry);
      const label = k === 0 ? `${d.getUTCDate()}${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}` : `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCFullYear()).slice(2)}`;
      return { expiry, label, callOi: instruments.filter((x) => x.type === "call").reduce((s, x) => s + x.oi, 0), putOi: instruments.filter((x) => x.type === "put").reduce((s, x) => s + x.oi, 0), maxPain: maxPain(instruments), strikes: strikes.length };
    });
    const callOi = expiries.reduce((s, e) => s + e.callOi, 0);
    const putOi = expiries.reduce((s, e) => s + e.putOi, 0);
    return { venue, oiBase: callOi + putOi, oiUsd: (callOi + putOi) * price, volume24hUsd: (callOi + putOi) * price * 0.05, putCallOi: putOi / callOi, underlyingPrice: price, instruments: expiries.length * 18, expiries };
  });
  return { symbol, venues };
}
/** 1000 daily closes with the averages and the log fit (PR 5.4a). */
export function mockCycle(): CycleData {
  const closes = walk(1400, 1000, 864e5, 22_000, 0.05, 1000).map((p) => ({ t: p.t, v: p.v * 1.0025 ** 0 }));
  // drift so the last close lands on the mock BTC price
  const scale = 80_000 / closes[closes.length - 1]!.v;
  const c = closes.map((p, i) => ({ t: p.t, close: p.v * (1 + (scale - 1) * (i / (closes.length - 1))) }));
  const vals = c.map((p) => p.close);
  const ma111 = sma(vals, 111);
  const ma350 = sma(vals, 350);
  const ma730 = sma(vals, 730);
  const fit = logLinearFit(vals);
  return { symbol: "BTC", points: c.map((p, i) => ({ t: p.t, close: p.close, ma111: ma111[i] ?? null, ma350x2: ma350[i] === null || ma350[i] === undefined ? null : ma350[i] * 2, ma2y: ma730[i] ?? null, ma2yX5: ma730[i] === null || ma730[i] === undefined ? null : ma730[i] * 5, fit: fit[i]! })), rainbowMultipliers: [...RAINBOW_MULTIPLIERS], rainbowNames: [...RAINBOW_NAMES], windowDays: 1000 };
}
export function mockRsi(): RsiData {
  return { period: 14, rows: COINS.map(([symbol, , price], i) => { const r = rng(1500 + i); const rsi: Partial<Record<(typeof RSI_TIMEFRAMES)[number], number | null>> = {}; RSI_TIMEFRAMES.forEach((tf, k) => { rsi[tf] = i === 2 && k === 0 ? null : Math.round(15 + r() * 70); }); return { symbol, price, rsi }; }) };
}
export function mockPremium(): PremiumData {
  const points = walk(1600, 24 * 30, 3600e3, 0, 0, -1e9).map((p, i) => ({ t: p.t, v: Number((Math.sin(i / 9) * 35 + (rng(i)() - 0.5) * 20).toFixed(2)) }));
  const last = points[points.length - 1]!.v;
  return { symbol: "BTC", coinbaseUsd: 80_000 + last, binanceUsd: 80_000, premiumUsd: last, premiumPct: last / 80_000, points };
}

/** Every snapshot keyed the way the API serves them; the per-symbol datasets cover all ten mock coins. */
export function mockAnalyticsSnapshots(): Map<string, AnalyticsSnapshot> {
  const map = new Map<string, AnalyticsSnapshot>();
  for (const [symbol] of COINS) {
    map.set(analyticsKey("funding", symbol), envelope("funding", analyticsKey("funding", symbol), "Binance · Bybit · OKX", mockFunding(symbol)));
    map.set(analyticsKey("open-interest", symbol), envelope("open-interest", analyticsKey("open-interest", symbol), "Binance · Bybit · OKX", mockOpenInterest(symbol)));
    map.set(analyticsKey("long-short", symbol), envelope("long-short", analyticsKey("long-short", symbol), "Binance", mockLongShort(symbol)));
    map.set(analyticsKey("taker-volume", symbol), envelope("taker-volume", analyticsKey("taker-volume", symbol), "Binance", mockTakerVolume(symbol)));
  }
  map.set(analyticsKey("liquidations"), envelope("liquidations", analyticsKey("liquidations"), "Binance · Bybit · OKX", mockLiquidations(), 15_000));
  for (const symbol of ["BTC", "ETH"]) map.set(analyticsKey("options", symbol), envelope("options", analyticsKey("options", symbol), "Deribit · Delta India", mockOptions(symbol), 300_000));
  map.set(analyticsKey("cycle"), envelope("cycle", analyticsKey("cycle"), "Bybit spot · daily closes", mockCycle(), 3_600_000));
  map.set(analyticsKey("rsi"), envelope("rsi", analyticsKey("rsi"), "Bybit perpetuals", mockRsi(), 300_000));
  map.set(analyticsKey("premium"), envelope("premium", analyticsKey("premium"), "Coinbase · Binance via CoinGecko", mockPremium(), 3_600_000));
  map.set(analyticsKey("overview"), envelope("overview", analyticsKey("overview"), "Binance · Bybit · OKX · alternative.me · CoinGecko", mockOverview()));
  map.set(analyticsKey("markets"), envelope("markets", analyticsKey("markets"), "CoinGecko", { rows: mockMarketRows(), global: { totalMarketCap: 2.9e12, volume24h: 9e10, btcDominance: 55.1, ethDominance: 12.4 } }, 600_000));
  const fg = mockOverview().fearGreedHistory;
  const last = fg[fg.length - 1]!;
  map.set(analyticsKey("fear-greed"), envelope("fear-greed", analyticsKey("fear-greed"), "alternative.me", { points: fg, latest: { value: last.v, label: fearGreedLabel(last.v), at: last.t } }, 3_600_000));
  return map;
}

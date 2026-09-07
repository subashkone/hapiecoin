// Chain rows built from the recorded Delta India instrument list (instruments.json, 03 Sep 2026).
// Strikes are exactly the listed ones (ADR-006); quotes come from recorded BTC tickers where available and
// a deterministic synthetic model elsewhere. Pure: no server, safe to import from jsdom tests.
import { makeInstrumentId, type ChainRow, type Quote, type Underlying } from "@hapiecoin/schema";
import fixture from "./instruments.json" with { type: "json" };

export interface FixtureInstrument {
  symbol: string;
  underlying: Underlying;
  kind: "call" | "put";
  strike: string;
  expiry: string;
}
export interface Seed {
  mark: string;
  bid?: string;
  ask?: string;
  markIv: number;
  bidIv?: number;
  askIv?: number;
  oi: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  spot: string;
}
export interface Fixture {
  instruments: FixtureInstrument[];
  seeds: Record<string, Seed>;
}

export const FIXTURE = fixture as Fixture;

export const SPOT0: Record<Underlying, number> = { BTC: 79521, ETH: 4210.5, XAUT: 3425.2 };

/** Deterministic pseudo-random so screenshots and assertions are stable across runs. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dec(n: number, digits = 1): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

function synthQuote(inst: FixtureInstrument, spot: number, ts: number, rnd: () => number): Quote {
  const k = Number(inst.strike);
  const dist = (k - spot) / spot;
  const intrinsic = inst.kind === "call" ? Math.max(0, spot - k) : Math.max(0, k - spot);
  const timeValue = spot * 0.045 * Math.exp(-8 * dist * dist);
  const mark = intrinsic + timeValue;
  const iv = 0.42 + Math.abs(dist) * 0.6 + (rnd() - 0.5) * 0.02;
  const delta = inst.kind === "call" ? 1 / (1 + Math.exp(dist * 25)) : -1 / (1 + Math.exp(-dist * 25));
  return {
    instrumentId: makeInstrumentId("delta_india", inst.symbol),
    ts,
    mark: dec(mark),
    bid: dec(mark * 0.985),
    ask: dec(mark * 1.015),
    markIv: Number(iv.toFixed(4)),
    bidIv: Number((iv - 0.004).toFixed(4)),
    askIv: Number((iv + 0.004).toFixed(4)),
    oi: dec(Math.round(rnd() * 12000 + 500), 0),
    spot: dec(spot),
    greeks: { delta: Number(delta.toFixed(4)), gamma: 0.00002, theta: -20, vega: 90 },
  };
}

function seededQuote(inst: FixtureInstrument, seed: Seed, ts: number): Quote {
  const q: Quote = {
    instrumentId: makeInstrumentId("delta_india", inst.symbol),
    ts,
    mark: dec(Number(seed.mark), 1),
    markIv: Number(seed.markIv.toFixed(4)),
    oi: seed.oi,
    spot: seed.spot,
    greeks: { delta: seed.delta, gamma: seed.gamma, theta: seed.theta, vega: seed.vega },
  };
  if (seed.bid) q.bid = seed.bid;
  if (seed.ask) q.ask = seed.ask;
  if (seed.bidIv !== undefined) q.bidIv = Number(seed.bidIv.toFixed(4));
  if (seed.askIv !== undefined) q.askIv = Number(seed.askIv.toFixed(4));
  return q;
}

export function buildChain(underlying: Underlying, expiry: string, ts = 1_788_800_000_000, fx: Fixture = FIXTURE): ChainRow[] {
  const rnd = mulberry32(expiry.length + underlying.length + Number(expiry.replace(/-/g, "")));
  const byStrike = new Map<string, ChainRow>();
  for (const inst of fx.instruments) {
    if (inst.underlying !== underlying || inst.expiry !== expiry) continue;
    const row = byStrike.get(inst.strike) ?? { strike: inst.strike };
    const seed = fx.seeds[inst.symbol];
    row[inst.kind] = seed ? seededQuote(inst, seed, ts) : synthQuote(inst, SPOT0[underlying], ts, rnd);
    byStrike.set(inst.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => Number(a.strike) - Number(b.strike));
}

export function expiriesOf(fx: Fixture = FIXTURE): Record<Underlying, string[]> {
  const out: Record<Underlying, Set<string>> = { BTC: new Set(), ETH: new Set(), XAUT: new Set() };
  for (const i of fx.instruments) out[i.underlying].add(i.expiry);
  return { BTC: [...out.BTC].sort(), ETH: [...out.ETH].sort(), XAUT: [...out.XAUT].sort() };
}

/** Strikes listed for one underlying/expiry, ascending, as decimal strings. */
export function strikesOf(underlying: Underlying, expiry: string, fx: Fixture = FIXTURE): string[] {
  return [...new Set(fx.instruments.filter((i) => i.underlying === underlying && i.expiry === expiry).map((i) => i.strike))].sort(
    (a, b) => Number(a) - Number(b),
  );
}

/** Node-only: read the fixture from disk (the fake gateway runs under tsx, where JSON import assertions vary). */
export function loadFixtureFile(): Fixture {
  return FIXTURE;
}

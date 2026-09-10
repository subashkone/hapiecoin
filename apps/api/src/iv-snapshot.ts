/**
 * IV history snapshotter (ADR-056; GAPS #62, #31, #32). Every `intervalMs` the API reads the venue's public option
 * tickers for each underlying and records (1) the ATM implied volatility per listed expiry with the spot, flagging the
 * "front" expiry the daily series is built from (the nearest with two or more days left, so the expiry-day collapse
 * never enters the year's range), and (2) every option's mark and mark IV for the details sparkline. Retention:
 * 400 days of IV rows, 7 days of marks. Public data only: no key, no order path, never a private endpoint.
 */
import type { Instrument, Quote, Underlying } from "@hapiecoin/schema";
import { UNDERLYINGS } from "@hapiecoin/schema";
import { and, lt } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { instrumentMarks, ivSnapshots } from "./db/schema.js";
import type { Logger } from "./logger.js";

export interface MarketSource {
  /** Active option instruments (every underlying). */
  products(): Promise<Instrument[]>;
  /** Option tickers for one underlying. */
  tickers(underlying: Underlying): Promise<Quote[]>;
}

export interface SnapshotDeps {
  db: Db;
  logger: Logger;
}

export const IV_ROWS_RETENTION_DAYS = 400;
export const MARK_ROWS_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ExpiryIv {
  expiry: string;
  atmIv: number;
  strike: number;
}

/** ATM IV per expiry: the mean of the call and put mark IV at the strike nearest the spot (either side may be missing). */
export function atmIvByExpiry(instruments: readonly Instrument[], quotes: readonly Quote[], spot: number): ExpiryIv[] {
  const bySymbol = new Map(instruments.map((i) => [i.id, i]));
  const best = new Map<string, { strike: number; distance: number; ivs: number[] }>();
  for (const q of quotes) {
    const inst = bySymbol.get(q.instrumentId);
    if (!inst || (inst.kind !== "call" && inst.kind !== "put") || inst.strike === undefined || inst.expiry === undefined) continue;
    if (q.markIv === undefined || !(q.markIv > 0)) continue;
    const strike = Number(inst.strike);
    const distance = Math.abs(strike - spot);
    const cur = best.get(inst.expiry);
    if (!cur || distance < cur.distance) best.set(inst.expiry, { strike, distance, ivs: [q.markIv] });
    else if (distance === cur.distance) cur.ivs.push(q.markIv);
  }
  return [...best.entries()]
    .map(([expiry, b]) => ({ expiry, strike: b.strike, atmIv: b.ivs.reduce((s, v) => s + v, 0) / b.ivs.length }))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

/** The expiry the daily series follows: the nearest listed with ≥ 2 days left, else the nearest. */
export function frontExpiry(expiries: readonly string[], nowMs: number): string | null {
  const sorted = [...expiries].sort();
  const twoDays = sorted.find((e) => Date.parse(`${e}T12:00:00Z`) - nowMs >= 2 * DAY_MS);
  return twoDays ?? sorted[0] ?? null;
}

export interface SnapshotReport {
  at: string;
  assets: Record<string, { expiries: number; marks: number; spot: number | null }>;
}

/** One pass over every underlying; failures on one underlying are logged and the others still land. */
export async function snapshotOnce(deps: SnapshotDeps, source: MarketSource, now: () => number = Date.now): Promise<SnapshotReport> {
  const at = new Date(now());
  const instruments = (await source.products()).filter((i) => i.isActive && (i.kind === "call" || i.kind === "put"));
  const report: SnapshotReport = { at: at.toISOString(), assets: {} };
  for (const asset of UNDERLYINGS) {
    try {
      const quotes = await source.tickers(asset);
      const spotQuote = quotes.find((q) => Number(q.spot) > 0);
      const spot = spotQuote ? Number(spotQuote.spot) : null;
      const mine = instruments.filter((i) => i.underlying === asset);
      const byExpiry = spot === null ? [] : atmIvByExpiry(mine, quotes, spot);
      const front = frontExpiry(byExpiry.map((e) => e.expiry), at.getTime());
      if (spot !== null && byExpiry.length) {
        await deps.db.insert(ivSnapshots).values(byExpiry.map((e) => ({ asset, expiry: e.expiry, ts: at, atmIv: String(e.atmIv), spot: String(spot), atmStrike: String(e.strike), front: e.expiry === front })));
      }
      const known = new Set(mine.map((i) => i.id));
      const marks = quotes.filter((q) => known.has(q.instrumentId)).map((q) => ({ asset, symbol: q.instrumentId.slice(q.instrumentId.indexOf(":") + 1), ts: at, mark: q.mark, markIv: q.markIv === undefined ? null : String(q.markIv) }));
      for (let i = 0; i < marks.length; i += 500) await deps.db.insert(instrumentMarks).values(marks.slice(i, i + 500));
      report.assets[asset] = { expiries: byExpiry.length, marks: marks.length, spot };
    } catch (e) {
      deps.logger.warn({ asset, err: e instanceof Error ? e.message : String(e) }, "iv snapshot failed for one underlying");
      report.assets[asset] = { expiries: 0, marks: 0, spot: null };
    }
  }
  await deps.db.delete(ivSnapshots).where(lt(ivSnapshots.ts, new Date(at.getTime() - IV_ROWS_RETENTION_DAYS * DAY_MS)));
  await deps.db.delete(instrumentMarks).where(and(lt(instrumentMarks.ts, new Date(at.getTime() - MARK_ROWS_RETENTION_DAYS * DAY_MS))));
  return report;
}

/** Run `snapshotOnce` now and every `intervalMs`, never overlapping; returns the stop function. */
export function startIvSnapshotter(deps: SnapshotDeps, source: MarketSource, intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await snapshotOnce(deps, source);
      deps.logger.info({ at: report.at, assets: report.assets }, "iv snapshot recorded");
    } catch (e) {
      deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "iv snapshot failed");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

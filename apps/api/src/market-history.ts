/**
 * Read side of the IV history (ADR-056): the daily front-expiry ATM IV series, IV rank and percentile over a year,
 * 30-day realised volatility from the daily spot closes, the 24 h spot range, and a per-instrument mark history.
 */
import { type IvHistory, type IvPoint, type MarkHistory, type Underlying, ivRankOf, realisedVolOf } from "@hapiecoin/schema";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { instrumentMarks, ivSnapshots } from "./db/schema.js";

const DAY_MS = 86_400_000;
export const SERIES_DAYS = 365;
export const RV_DAYS = 30;

export async function ivHistory(db: Db, asset: Underlying, now: () => number = Date.now): Promise<IvHistory> {
  const nowMs = now();
  const since = new Date(nowMs - (SERIES_DAYS + 1) * DAY_MS);
  const rows = await db
    .select({ ts: ivSnapshots.ts, atmIv: ivSnapshots.atmIv, spot: ivSnapshots.spot, expiry: ivSnapshots.expiry })
    .from(ivSnapshots)
    .where(and(eq(ivSnapshots.asset, asset), eq(ivSnapshots.front, true), gte(ivSnapshots.ts, since)))
    .orderBy(asc(ivSnapshots.ts));
  const last = rows.at(-1);
  // the last snapshot of each UTC day is that day's point
  const byDay = new Map<string, IvPoint>();
  for (const r of rows) byDay.set(r.ts.toISOString().slice(0, 10), { day: r.ts.toISOString().slice(0, 10), atmIv: Number(r.atmIv), spot: Number(r.spot), expiry: r.expiry });
  const series = [...byDay.values()].slice(-SERIES_DAYS);
  const current = last ? { atmIv: Number(last.atmIv), spot: Number(last.spot), expiry: last.expiry, ts: last.ts.toISOString() } : null;
  const rank = current ? ivRankOf(series.map((p) => p.atmIv), current.atmIv) : null;
  const rv = realisedVolOf(series.slice(-RV_DAYS).map((p) => p.spot));
  const realised = rv && current ? { rv30: rv.rv, days: rv.days, spread: current.atmIv - rv.rv } : null;
  const dayAgo = nowMs - DAY_MS;
  const recent = rows.filter((r) => r.ts.getTime() >= dayAgo).map((r) => Number(r.spot));
  const spot24h = recent.length ? { high: Math.max(...recent), low: Math.min(...recent) } : null;
  return { asset, asOf: last ? last.ts.toISOString() : null, current, rank, realised, spot24h, series };
}

export async function markHistory(db: Db, symbol: string, hours: number, now: () => number = Date.now): Promise<MarkHistory> {
  const since = new Date(now() - hours * 3_600_000);
  const rows = await db
    .select({ ts: instrumentMarks.ts, mark: instrumentMarks.mark, markIv: instrumentMarks.markIv })
    .from(instrumentMarks)
    .where(and(eq(instrumentMarks.symbol, symbol), gte(instrumentMarks.ts, since)))
    .orderBy(asc(instrumentMarks.ts), desc(instrumentMarks.id));
  return { symbol, hours, points: rows.map((r) => ({ ts: r.ts.toISOString(), mark: Number(r.mark), markIv: r.markIv === null ? null : Number(r.markIv) })) };
}

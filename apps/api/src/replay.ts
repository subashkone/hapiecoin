/**
 * Replay read side (ADR-079; HC-WS-113): which expiries have a recorded chain, the instants one was recorded at, and
 * the ladder at an instant. Daily instants come from `chain_eod` (400 days); 5-minute instants from `instrument_marks`
 * (7 days) with the spot of the same pass from `iv_snapshots`. Every query is bound by an index: the latest pass is
 * found through `iv_snapshots` (venue, asset, ts), the passes of an expiry through its symbols (venue, symbol, ts),
 * the ladder at a pass through the pass's timestamp.
 */
import type { ReplayChain, ReplayExpiries, ReplayRow, ReplaySteps, Underlying, Venue } from "@hapiecoin/schema";
import { REPLAY_FINE_DAYS } from "@hapiecoin/schema";
import { getVenue } from "@hapiecoin/venues";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { chainEod, instrumentMarks, ivSnapshots } from "./db/schema.js";

const DAY_MS = 86_400_000;

/** The symbols of the venue's latest pass, parsed and grouped by expiry: what is listed right now. */
async function latestListed(db: Db, venue: Venue, asset: Underlying): Promise<{ ts: Date; byExpiry: Map<string, string[]> } | null> {
  // the latest pass through the IV rows (indexed by venue, asset, ts), never a backwards walk of the marks
  const [last] = await db
    .select({ ts: ivSnapshots.ts })
    .from(ivSnapshots)
    .where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset)))
    .orderBy(desc(ivSnapshots.ts))
    .limit(1);
  if (!last) return null;
  const rows = await db
    .select({ symbol: instrumentMarks.symbol })
    .from(instrumentMarks)
    .where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset), eq(instrumentMarks.ts, last.ts)));
  const codec = getVenue(venue).symbols;
  const byExpiry = new Map<string, string[]>();
  for (const r of rows) {
    if (!codec.isOption(r.symbol)) continue;
    const p = codec.parseOption(r.symbol);
    const list = byExpiry.get(p.expiryDate) ?? [];
    list.push(r.symbol);
    byExpiry.set(p.expiryDate, list);
  }
  return { ts: last.ts, byExpiry };
}

export async function replayExpiries(db: Db, venue: Venue, asset: Underlying): Promise<ReplayExpiries> {
  const eod = await db
    .select({ expiry: chainEod.expiry, days: sql<number>`count(distinct ${chainEod.day})` })
    .from(chainEod)
    .where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset)))
    .groupBy(chainEod.expiry);
  const listed = await latestListed(db, venue, asset);
  const out = new Map<string, { expiry: string; days: number; listed: boolean }>();
  for (const e of eod) out.set(e.expiry, { expiry: e.expiry, days: Number(e.days), listed: false });
  for (const expiry of listed?.byExpiry.keys() ?? []) out.set(expiry, { expiry, days: out.get(expiry)?.days ?? 0, listed: true });
  return { asset, venue, expiries: [...out.values()].sort((a, b) => a.expiry.localeCompare(b.expiry)) };
}

/** The symbols of the expiry to read its passes through: every one of the latest pass, else the newest end-of-day row's. */
async function symbolsOf(db: Db, venue: Venue, asset: Underlying, expiry: string): Promise<string[]> {
  const listed = await latestListed(db, venue, asset);
  const fromPass = listed?.byExpiry.get(expiry);
  if (fromPass?.length) return fromPass;
  const [row] = await db
    .select({ strike: chainEod.strike, kind: chainEod.kind })
    .from(chainEod)
    .where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset), eq(chainEod.expiry, expiry)))
    .orderBy(desc(chainEod.day))
    .limit(1);
  return row ? [getVenue(venue).symbols.formatOption(row.kind, asset, row.strike, expiry)] : [];
}

export async function replaySteps(db: Db, venue: Venue, asset: Underlying, expiry: string, now: () => number = Date.now): Promise<ReplaySteps> {
  const dailyRows = await db
    .select({ day: chainEod.day, ts: sql<Date>`min(${chainEod.ts})`, spot: sql<string>`min(${chainEod.spot})` })
    .from(chainEod)
    .where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset), eq(chainEod.expiry, expiry)))
    .groupBy(chainEod.day)
    .orderBy(asc(chainEod.day));
  const daily = dailyRows.map((r) => ({ day: r.day, ts: new Date(r.ts).toISOString(), spot: Number(r.spot) }));
  const since = new Date(now() - REPLAY_FINE_DAYS * DAY_MS);
  const symbols = await symbolsOf(db, venue, asset, expiry);
  let fine: ReplaySteps["fine"] = [];
  if (symbols.length) {
    // every pass any symbol of the expiry was quoted at (a strike listed late must not shorten the window)
    const passes = await db
      .selectDistinct({ ts: instrumentMarks.ts })
      .from(instrumentMarks)
      .where(and(eq(instrumentMarks.venue, venue), inArray(instrumentMarks.symbol, symbols), gte(instrumentMarks.ts, since)))
      .orderBy(asc(instrumentMarks.ts));
    if (passes.length) {
      // one spot per pass: the front-expiry row of each IV snapshot (indexed by venue, asset, front, ts)
      const spots = await db
        .select({ ts: ivSnapshots.ts, spot: ivSnapshots.spot })
        .from(ivSnapshots)
        .where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset), eq(ivSnapshots.front, true), gte(ivSnapshots.ts, since)));
      const spotAt = new Map(spots.map((s) => [s.ts.getTime(), Number(s.spot)]));
      fine = passes.flatMap((p) => {
        const spot = spotAt.get(p.ts.getTime());
        return spot === undefined ? [] : [{ ts: p.ts.toISOString(), spot }];
      });
    }
  }
  return { asset, venue, expiry, daily, fine };
}

function fold(rows: { strike: string; kind: "call" | "put"; mark: string; markIv: string | null }[]): ReplayRow[] {
  const byStrike = new Map<string, ReplayRow>();
  for (const r of rows) {
    const row = byStrike.get(r.strike) ?? { strike: r.strike, call: null, put: null };
    const q = { mark: Number(r.mark), iv: r.markIv === null ? null : Number(r.markIv) };
    if (r.kind === "call") row.call = q;
    else row.put = q;
    byStrike.set(r.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => Number(a.strike) - Number(b.strike));
}

/** The ladder at an instant: the end-of-day rows stamped then, else the marks of that pass; null when nothing was recorded then. */
export async function replayChain(db: Db, venue: Venue, asset: Underlying, expiry: string, at: Date): Promise<ReplayChain | null> {
  const eod = await db
    .select({ strike: chainEod.strike, kind: chainEod.kind, mark: chainEod.mark, markIv: chainEod.markIv, spot: chainEod.spot })
    .from(chainEod)
    .where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset), eq(chainEod.expiry, expiry), eq(chainEod.ts, at)));
  if (eod.length) return { asset, venue, expiry, at: at.toISOString(), source: "eod", spot: Number(eod[0]!.spot), rows: fold(eod) };
  const marks = await db
    .select({ symbol: instrumentMarks.symbol, mark: instrumentMarks.mark, markIv: instrumentMarks.markIv })
    .from(instrumentMarks)
    .where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset), eq(instrumentMarks.ts, at)));
  const codec = getVenue(venue).symbols;
  const mine: { strike: string; kind: "call" | "put"; mark: string; markIv: string | null }[] = [];
  for (const m of marks) {
    if (!codec.isOption(m.symbol)) continue;
    const p = codec.parseOption(m.symbol);
    if (p.expiryDate !== expiry) continue;
    mine.push({ strike: p.strike, kind: p.kind, mark: m.mark, markIv: m.markIv });
  }
  if (mine.length === 0) return null;
  const [snap] = await db
    .select({ spot: ivSnapshots.spot })
    .from(ivSnapshots)
    .where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset), eq(ivSnapshots.ts, at)))
    .limit(1);
  if (!snap) return null;
  return { asset, venue, expiry, at: at.toISOString(), source: "marks", spot: Number(snap.spot), rows: fold(mine) };
}

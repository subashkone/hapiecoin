/**
 * End-of-day option chains (ADR-077; HC-SH-128): once a day per venue and underlying, the first snapshot pass at or
 * after the asset's settlement hour writes every listed option's mark and mark IV with the spot into `chain_eod`,
 * kept 400 days. The first write for a venue and underlying also backfills up to the previous week from the 5-minute
 * mark stream (the last pass at or before the settlement hour each day; the marks are kept 7 days, so the oldest day
 * may already be gone), so a backtest has close to a week of history on day one. The read side folds the rows into the
 * pricing package's `EodDay` shape.
 */
import type { Instrument, Quote, Underlying, Venue } from "@hapiecoin/schema";
import type { EodDay, EodRow } from "@hapiecoin/pricing";
import { getVenue } from "@hapiecoin/venues";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { chainEod, instrumentMarks, ivSnapshots } from "./db/schema.js";

export const EOD_ROWS_RETENTION_DAYS = 400;
export const EOD_BACKFILL_DAYS = 7;
const DAY_MS = 86_400_000;
const BATCH = 500;

type EodInsert = typeof chainEod.$inferInsert;
/** What a day's rows are written through: the transaction, so a failed batch leaves no half ladder for the gate to mistake for a done day. */
type Writer = Pick<Db, "insert">;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

async function hasRows(db: Db, venue: Venue, asset: Underlying, day?: string): Promise<boolean> {
  const where = day === undefined ? and(eq(chainEod.venue, venue), eq(chainEod.asset, asset)) : and(eq(chainEod.venue, venue), eq(chainEod.asset, asset), eq(chainEod.day, day));
  const [row] = await db.select({ id: chainEod.id }).from(chainEod).where(where).limit(1);
  return row !== undefined;
}

async function insertRows(w: Writer, rows: EodInsert[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) await w.insert(chainEod).values(rows.slice(i, i + BATCH)).onConflictDoNothing();
}

/** A whole day's rows land or none do. */
async function insertDay(db: Db, rows: EodInsert[]): Promise<void> {
  await db.transaction(async (tx) => {
    await insertRows(tx, rows);
  });
}

/**
 * Record today's end-of-day chain from this pass's quotes when the pass is at or after the settlement hour and the
 * day has none yet. Returns the rows written (0 when not due). The very first write for the venue and underlying
 * backfills the previous week from `instrument_marks`.
 */
export async function recordEodIfDue(
  db: Db,
  input: { venue: Venue; asset: Underlying; at: Date; spot: number; instruments: readonly Instrument[]; quotes: readonly Quote[]; settlementHourUtc: number },
): Promise<{ written: number; backfilledDays: number }> {
  const { venue, asset, at } = input;
  if (at.getUTCHours() < input.settlementHourUtc) return { written: 0, backfilledDays: 0 };
  const day = dayOf(at);
  if (await hasRows(db, venue, asset, day)) return { written: 0, backfilledDays: 0 };
  const first = !(await hasRows(db, venue, asset));
  const bySymbol = new Map(input.instruments.map((i) => [i.id, i]));
  const rows: EodInsert[] = [];
  for (const q of input.quotes) {
    const inst = bySymbol.get(q.instrumentId);
    if (!inst || (inst.kind !== "call" && inst.kind !== "put") || inst.strike === undefined || inst.expiry === undefined) continue;
    rows.push({ venue, asset, day, expiry: inst.expiry, strike: inst.strike, kind: inst.kind, mark: q.mark, markIv: q.markIv === undefined ? null : String(q.markIv), spot: String(input.spot), ts: at });
  }
  if (rows.length === 0) return { written: 0, backfilledDays: 0 };
  await insertDay(db, rows);
  const backfilledDays = first ? await backfillEodFromMarks(db, venue, asset, at, input.settlementHourUtc) : 0;
  return { written: rows.length, backfilledDays };
}

/**
 * The previous `EOD_BACKFILL_DAYS` days from the 5-minute mark stream: for each day the last pass at or before the
 * settlement hour, its marks parsed back into strike / expiry / kind through the venue's symbol codec, and the spot
 * from the IV snapshot of the same pass. Days without a pass are skipped. Returns the days written.
 */
export async function backfillEodFromMarks(db: Db, venue: Venue, asset: Underlying, before: Date, settlementHourUtc: number): Promise<number> {
  const codec = getVenue(venue).symbols;
  let written = 0;
  for (let back = 1; back <= EOD_BACKFILL_DAYS; back++) {
    const dayStart = new Date(Date.UTC(before.getUTCFullYear(), before.getUTCMonth(), before.getUTCDate() - back));
    const day = dayOf(dayStart);
    const cutoff = new Date(dayStart.getTime() + settlementHourUtc * 3_600_000);
    const [lastPass] = await db
      .select({ ts: instrumentMarks.ts })
      .from(instrumentMarks)
      .where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset), gte(instrumentMarks.ts, dayStart), lte(instrumentMarks.ts, cutoff)))
      .orderBy(desc(instrumentMarks.ts))
      .limit(1);
    if (!lastPass) continue;
    const [snap] = await db
      .select({ spot: ivSnapshots.spot })
      .from(ivSnapshots)
      .where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset), eq(ivSnapshots.ts, lastPass.ts)))
      .limit(1);
    if (!snap) continue;
    const marks = await db
      .select({ symbol: instrumentMarks.symbol, mark: instrumentMarks.mark, markIv: instrumentMarks.markIv })
      .from(instrumentMarks)
      .where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset), eq(instrumentMarks.ts, lastPass.ts)));
    const rows: EodInsert[] = [];
    for (const m of marks) {
      if (!codec.isOption(m.symbol)) continue;
      const p = codec.parseOption(m.symbol);
      rows.push({ venue, asset, day, expiry: p.expiryDate, strike: p.strike, kind: p.kind, mark: m.mark, markIv: m.markIv, spot: snap.spot, ts: lastPass.ts });
    }
    if (rows.length === 0) continue;
    await insertDay(db, rows);
    written += 1;
  }
  return written;
}

export async function pruneEod(db: Db, now: Date): Promise<void> {
  await db.delete(chainEod).where(lt(chainEod.ts, new Date(now.getTime() - EOD_ROWS_RETENTION_DAYS * DAY_MS)));
}

/** The recorded days of one underlying, oldest first, folded into ladders per expiry (ascending strikes). */
export async function eodDays(db: Db, venue: Venue, asset: Underlying, range: { from?: string | undefined; to?: string | undefined } = {}): Promise<EodDay[]> {
  const conds = [eq(chainEod.venue, venue), eq(chainEod.asset, asset)];
  if (range.from) conds.push(gte(chainEod.day, range.from));
  if (range.to) conds.push(lte(chainEod.day, range.to));
  const rows = await db
    .select({ day: chainEod.day, expiry: chainEod.expiry, strike: chainEod.strike, kind: chainEod.kind, mark: chainEod.mark, markIv: chainEod.markIv, spot: chainEod.spot, ts: chainEod.ts })
    .from(chainEod)
    .where(and(...conds))
    .orderBy(asc(chainEod.day), asc(chainEod.expiry), asc(sql`(${chainEod.strike})::numeric`));
  const days = new Map<string, EodDay>();
  for (const r of rows) {
    let d = days.get(r.day);
    if (!d) {
      d = { day: r.day, ts: r.ts.getTime(), spot: Number(r.spot), expiries: [] };
      days.set(r.day, d);
    }
    let e = d.expiries.find((x) => x.expiry === r.expiry);
    if (!e) {
      e = { expiry: r.expiry, rows: [] };
      d.expiries.push(e);
    }
    const strike = Number(r.strike);
    let row: EodRow | undefined = e.rows.find((x) => x.strike === strike);
    if (!row) {
      row = { strike };
      e.rows.push(row);
    }
    const q = { mark: Number(r.mark), iv: r.markIv === null ? undefined : Number(r.markIv) };
    if (r.kind === "call") row.call = q;
    else row.put = q;
  }
  return [...days.values()];
}

/** The folded days of a venue and underlying, memoised in process and revalidated by a cheap count: the table changes once a day, the tab asks per template. */
const memo = new Map<string, { stamp: string; days: EodDay[] }>();
export async function eodDaysCached(db: Db, venue: Venue, asset: Underlying): Promise<EodDay[]> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`, lastDay: sql<string | null>`max(${chainEod.day})` })
    .from(chainEod)
    .where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset)));
  const stamp = `${row?.lastDay ?? ""}:${Number(row?.n ?? 0)}`;
  const key = `${venue}:${asset}`;
  const hit = memo.get(key);
  if (hit && hit.stamp === stamp) return hit.days;
  const days = await eodDays(db, venue, asset);
  memo.set(key, { stamp, days });
  return days;
}
/** Tests reset the memo between databases. */
export function clearEodMemo(): void {
  memo.clear();
}

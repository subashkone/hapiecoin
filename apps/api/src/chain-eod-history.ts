/**
 * Chain history reconstructed from the venue's public candle history (ADR-098; HC-SH-140). `chain_eod` (ADR-077)
 * records a chain once a day from the day the snapshotter first ran, so the backtest reached back about two months.
 * Delta Exchange serves hourly `MARK:` candles for every option it ever listed, expired ones included, back more than
 * a year (probed 9 Nov 2026: dailies, weeklies, monthlies and quarterlies on BTC and ETH). For every expiry date in
 * the horizon this job finds the strikes that had candles, takes each one's close of the hourly bar that ends at the
 * settlement hour as that day's mark, and writes the rows with `source = "candles"`, never on a day the snapshotter
 * recorded. Mark IV is not reconstructed: candles carry none, so a modelled exit on such a day falls back to the IV
 * the leg was entered at (the engine already does). One row per expiry in `chain_eod_backfill` makes a restarted job
 * resume where it stopped. Public endpoint, no key, read-only toward the venue, under four requests a second. Today's
 * rows wait until the settlement bar has closed, and the live recorder (chain-eod.ts) replaces a reconstructed row
 * with its own, so the two writers never block each other.
 */
import type { Underlying, Venue } from "@hapiecoin/schema";
import type { Candle, VenueRest } from "@hapiecoin/venues";
import { getVenue } from "@hapiecoin/venues";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { dayOf } from "./chain-eod.js";
import { chainEod, chainEodBackfill } from "./db/schema.js";

/** Expiries listed ahead of today that the scan still visits (quarterlies list about three months out). */
export const HISTORY_FUTURE_DAYS = 100;
/** One hourly candle request spans this many days (the venue caps a response at 2,000 candles; 83 days = 1,992). */
export const HISTORY_WINDOW_DAYS = 83;
/** Consecutive strikes without candles that end the scan on one side of the spot range (quarterlies step 1,000 on a 200 grid, so five empties can sit between two listed strikes). */
export const HISTORY_EMPTY_RUN = 8;
/** Minimum gap between two candle requests (under four a second). */
export const HISTORY_MIN_GAP_MS = 270;
/** An unexpired expiry is rescanned once its last scan is older than this, so a gap in the live record fills in. */
export const HISTORY_RESCAN_DAYS = 7;
/** The whole horizon is walked again this often while the process lives. */
export const HISTORY_REPEAT_MS = 24 * 3_600_000;
/** A run that failed anywhere (the spot series, or any expiry) is repeated this soon instead. */
export const HISTORY_RETRY_MS = 10 * 60_000;
/** Listed strike step per underlying from the probe of 9 Nov 2026 (BTC 200, quarterlies 500 to 1,000; ETH 10, weeklies 20). XAUT was not probed and is not reconstructed. */
export const HISTORY_STRIKE_STEP: Partial<Record<Underlying, number>> = { BTC: 200, ETH: 10 };
/** Delta names the mark-price series of a product "MARK:<symbol>" in its candle history. */
const MARK_PREFIX = "MARK:";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BATCH = 500;

export interface CandleSource {
  candles: (params: { symbol: string; resolution: "1h"; start: number; end: number }) => Promise<Candle[]>;
}

export interface HistoryTarget {
  venue: Venue;
  asset: Underlying;
  /** Listed strike step the scan walks. */
  step: number;
  settlementHourUtc: number;
  /** Days back from today. */
  horizonDays: number;
  source: CandleSource;
  /** The candle symbol of an option (kind, strike, expiry YYYY-MM-DD). */
  markSymbol: (kind: "call" | "put", strike: number, expiry: string) => string;
  /** The candle symbol of the spot (the perpetual's mark). */
  spotSymbol: string;
}

export interface HistoryLog {
  info(o: object, msg: string): void;
  warn(o: object, msg: string): void;
}
export interface HistoryDeps {
  db: Db;
  logger: HistoryLog;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface HistoryTotals {
  /** Expiries scanned and marked done in this run. */
  expiries: number;
  rows: number;
  requests: number;
  /** Expiries whose earlier scan stands, left alone. */
  skipped: number;
  /** Expiries that could not be dated (no spot on their last day) or came back without a strike on a past date; not marked done, retried next run. */
  undated: number;
  /** Expiries whose requests failed three times running; not marked done, retried next run. */
  failed: number;
}

const dayOfMs = (ms: number): string => dayOf(new Date(ms));
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const shiftDay = (day: string, days: number): string => dayOfMs(dayMs(day) + days * DAY_MS);
/** The latest UTC day whose settlement bar has closed: that day once the hour after the settlement hour has begun, else the day before. */
export const lastFinalDay = (nowMs: number, settlementHourUtc: number): string => dayOfMs(nowMs - (settlementHourUtc + 1) * HOUR_MS);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The mark at the settlement hour per UTC day: the close of the hourly bar that ends at that hour, or, when that bar
 * does not exist (a product listed at the hour itself, as Delta lists the next daily at 12:00 UTC), the open of the
 * bar that starts at the hour. Keyed by day.
 * The values are the venue's decimal strings, stored as they came (no float round trip on a price).
 */
export function closesAtHour(candles: readonly Candle[], settlementHourUtc: number): Map<string, string> {
  const barBefore = (settlementHourUtc + 23) % 24;
  const out = new Map<string, string>();
  const opens = new Map<string, string>();
  const positive = (s: string) => Number.isFinite(Number(s)) && Number(s) > 0;
  for (const c of candles) {
    const t = new Date(c.time * 1000);
    if (t.getUTCMinutes() !== 0) continue;
    const hour = t.getUTCHours();
    const day = dayOfMs(t.getTime());
    if (hour === barBefore) {
      if (positive(c.close)) out.set(day, c.close);
    } else if (hour === settlementHourUtc) {
      if (positive(c.open)) opens.set(day, c.open);
    }
  }
  for (const [day, open] of opens) if (!out.has(day)) out.set(day, open);
  return out;
}

/** Every calendar day from `last` down to `first` (inclusive): Delta lists a daily expiry on every date, and the weeklies, monthlies and quarterlies fall on some of them. */
export function expiryDaysDescending(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = last; d >= first; d = shiftDay(d, -1)) out.push(d);
  return out;
}

/** A source that spaces requests `minGapMs` apart and makes up to three attempts per request with a growing pause between them; counts every attempt. */
export function throttledSource(source: CandleSource, opts: { minGapMs: number; now?: (() => number) | undefined; sleep?: ((ms: number) => Promise<void>) | undefined }): CandleSource & { requests: () => number } {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  let last = -Infinity;
  let requests = 0;
  return {
    requests: () => requests,
    candles: async (params) => {
      for (let attempt = 1; ; attempt++) {
        const wait = opts.minGapMs - (now() - last);
        if (wait > 0) await sleep(wait);
        last = now();
        requests += 1;
        try {
          return await source.candles(params);
        } catch (e) {
          if (attempt >= 3) throw e;
          await sleep(2_000 * attempt); // longer than the gap, so the next attempt goes straight out
        }
      }
    },
  };
}

/**
 * The settlement-hour closes of one candle symbol over [startMs, endMs]: one window of `HISTORY_WINDOW_DAYS`, and one
 * more before it when the first window reaches back to its own first day (a quarterly listed longer than a window).
 */
export async function closesOf(source: CandleSource, symbol: string, startMs: number, endMs: number, settlementHourUtc: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let end = endMs;
  for (let window = 0; window < 2 && end > startMs; window++) {
    const start = Math.max(startMs, end - HISTORY_WINDOW_DAYS * DAY_MS);
    const candles = await source.candles({ symbol, resolution: "1h", start: Math.floor(start / 1000), end: Math.floor(end / 1000) });
    const closes = closesAtHour(candles, settlementHourUtc);
    for (const [day, close] of closes) out.set(day, close);
    const firstDay = dayOfMs(start);
    if (!closes.has(firstDay) && !closes.has(shiftDay(firstDay, 1))) break; // the series started inside this window
    end = start;
  }
  return out;
}

/** The settlement-hour closes of a long series (the spot) over [startMs, endMs], read window by window from the newest; stops at the first window the venue has nothing for. */
export async function seriesOf(source: CandleSource, symbol: string, startMs: number, endMs: number, settlementHourUtc: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let end = endMs; end > startMs; end -= HISTORY_WINDOW_DAYS * DAY_MS) {
    const start = Math.max(startMs, end - HISTORY_WINDOW_DAYS * DAY_MS);
    const candles = await source.candles({ symbol, resolution: "1h", start: Math.floor(start / 1000), end: Math.floor(end / 1000) });
    if (candles.length === 0) break;
    for (const [day, close] of closesAtHour(candles, settlementHourUtc)) out.set(day, close);
  }
  return out;
}

export interface StrikeCloses {
  call: Map<string, string>;
  put: Map<string, string>;
}
export type FetchCloses = (kind: "call" | "put", strike: number) => Promise<Map<string, string>>;

/**
 * The strikes an expiry listed, found by walking the strike grid: every strike inside the spot range over the
 * expiry's life, then outward on each side until `emptyRun` consecutive strikes have no candles. A strike whose call
 * has no candles is taken as unlisted without asking for its put (Delta lists calls and puts in pairs), which halves
 * the cost of every grid step that is not a listed strike (coarse ladders, the edges).
 */
export async function scanExpiry(fetchCloses: FetchCloses, range: { low: number; high: number }, step: number, emptyRun = HISTORY_EMPTY_RUN): Promise<Map<number, StrikeCloses>> {
  const strikes = new Map<number, StrikeCloses>();
  const probe = async (strike: number): Promise<boolean> => {
    const call = await fetchCloses("call", strike);
    if (call.size === 0) return false;
    strikes.set(strike, { call, put: await fetchCloses("put", strike) });
    return true;
  };
  const lo = Math.floor(range.low / step) * step;
  const hi = Math.ceil(range.high / step) * step;
  for (let k = lo; k <= hi; k += step) await probe(k);
  for (let k = lo - step, empty = 0; k > 0 && empty < emptyRun; k -= step) empty = (await probe(k)) ? 0 : empty + 1;
  for (let k = hi + step, empty = 0; empty < emptyRun; k += step) empty = (await probe(k)) ? 0 : empty + 1;
  return new Map([...strikes.entries()].sort((a, b) => a[0] - b[0]));
}

export type EodHistoryRow = typeof chainEod.$inferInsert;

/**
 * The chain rows of one expiry: for every strike, side and day with a settlement-hour close, a row stamped at the
 * settlement hour with that day's spot and `source: "candles"`. The expiry's own settlement day is left out (the
 * option is settled, not quoted), as are the days in `skipDays` (recorded live), days before `firstDay` (the horizon),
 * days after `lastDay` (whose settlement bar has not closed yet) and days without a spot close.
 */
export function rowsForExpiry(input: { venue: Venue; asset: Underlying; expiry: string; strikes: ReadonlyMap<number, StrikeCloses>; spotByDay: ReadonlyMap<string, string>; settlementHourUtc: number; skipDays: ReadonlySet<string>; firstDay?: string | undefined; lastDay?: string | undefined }): EodHistoryRow[] {
  const rows: EodHistoryRow[] = [];
  for (const [strike, sides] of input.strikes) {
    for (const kind of ["call", "put"] as const) {
      for (const [day, mark] of sides[kind]) {
        if (day >= input.expiry || input.skipDays.has(day) || (input.firstDay !== undefined && day < input.firstDay) || (input.lastDay !== undefined && day > input.lastDay)) continue;
        const spot = input.spotByDay.get(day);
        if (spot === undefined) continue;
        rows.push({
          venue: input.venue,
          asset: input.asset,
          day,
          expiry: input.expiry,
          strike: String(strike),
          kind,
          mark,
          markIv: null,
          spot,
          ts: new Date(dayMs(day) + input.settlementHourUtc * HOUR_MS),
          source: "candles",
        });
      }
    }
  }
  return rows;
}

/** The days a venue and underlying were recorded live: the backfill never writes on them. */
async function snapshotDays(db: Db, venue: Venue, asset: Underlying): Promise<Set<string>> {
  const rows = await db.selectDistinct({ day: chainEod.day }).from(chainEod).where(and(eq(chainEod.venue, venue), eq(chainEod.asset, asset), eq(chainEod.source, "snapshot")));
  return new Set(rows.map((r) => r.day));
}

/**
 * Whether an expiry's last scan still stands: it ran on or after the expiry date (the last writable day, the one
 * before, had its settlement bar closed, so nothing more can appear), or less than a week ago.
 */
export function scanStands(expiry: string, doneAtMs: number | undefined, nowMs: number): boolean {
  if (doneAtMs === undefined) return false;
  return dayOfMs(doneAtMs) >= expiry || nowMs - doneAtMs < HISTORY_RESCAN_DAYS * DAY_MS;
}

/**
 * Walk one target's horizon, newest expiry first, and write every expiry not yet scanned. `stop()` is read between
 * expiries. Throws when the venue serves no spot candles at all (nothing can be dated without them) or when a
 * request fails three times running; the watermark table makes the next run resume.
 */
export async function backfillEodHistory(deps: HistoryDeps, target: HistoryTarget, stop: () => boolean = () => false): Promise<HistoryTotals> {
  const nowFn = deps.now ?? Date.now;
  const nowMs = nowFn();
  const today = dayOfMs(nowMs);
  const first = shiftDay(today, -target.horizonDays);
  const last = shiftDay(today, HISTORY_FUTURE_DAYS);
  const src = throttledSource(target.source, { minGapMs: HISTORY_MIN_GAP_MS, now: nowFn, sleep: deps.sleep });
  const spotByDay = await seriesOf(src, target.spotSymbol, dayMs(first), nowMs, target.settlementHourUtc);
  if (spotByDay.size === 0) throw new Error(`chain history: no spot candles for ${target.spotSymbol} on ${target.venue}`);
  const skipDays = await snapshotDays(deps.db, target.venue, target.asset);
  const done = new Map(
    (await deps.db.select({ expiry: chainEodBackfill.expiry, doneAt: chainEodBackfill.doneAt }).from(chainEodBackfill).where(and(eq(chainEodBackfill.venue, target.venue), eq(chainEodBackfill.asset, target.asset)))).map((r) => [r.expiry, r.doneAt.getTime()] as const),
  );
  const totals: HistoryTotals = { expiries: 0, rows: 0, requests: 0, skipped: 0, undated: 0, failed: 0 };
  // the latest day whose settlement bar has closed: today's rows wait until 13:00 UTC, so the live recorder's pass at 12:00 finds the day free
  const lastDay = lastFinalDay(nowMs, target.settlementHourUtc);
  // the expiry on the horizon's first day has every quote before the horizon: nothing of it is written
  for (const expiry of expiryDaysDescending(shiftDay(first, 1), last)) {
    if (stop()) break;
    if (scanStands(expiry, done.get(expiry), nowFn())) {
      totals.skipped += 1;
      continue;
    }
    const before = src.requests();
    // the last day this expiry was quoted that we can write: the day before it settles, or the last final day for one still listed
    let endDay = shiftDay(expiry, -1) < lastDay ? shiftDay(expiry, -1) : lastDay;
    while (!spotByDay.has(endDay) && endDay > first) endDay = shiftDay(endDay, -1);
    const spotAtEnd = spotByDay.get(endDay);
    if (spotAtEnd === undefined) {
      totals.undated += 1;
      continue;
    }
    try {
    const lifeEnd = Math.min(dayMs(expiry) + (target.settlementHourUtc + 1) * HOUR_MS, nowMs);
    const lifeStart = lifeEnd - 2 * HISTORY_WINDOW_DAYS * DAY_MS;
    const memo = new Map<string, Map<string, string>>();
    const fetchCloses: FetchCloses = async (kind, strike) => {
      const key = `${kind}:${strike}`;
      const hit = memo.get(key);
      if (hit) return hit;
      const closes = await closesOf(src, target.markSymbol(kind, strike, expiry), lifeStart, lifeEnd, target.settlementHourUtc);
      memo.set(key, closes);
      return closes;
    };
      // seed: the calls nearest the money on the last writable day, walking outward up to the empty run on each side
      // (a quarterly's ladder near the money can step 1,000 on the 200 grid), tell whether the date was listed at all and
      // how long ago it was listed, which bounds the spot range the core scan must cover (a daily lives two days, a
      // quarterly three months); an unlisted date costs the seed and nothing more
      const atm = Math.round(Number(spotAtEnd) / target.step) * target.step;
      let firstListed = endDay;
      let seeded = false;
      for (let offset = 0; offset <= HISTORY_EMPTY_RUN && !seeded; offset++) {
        for (const k of offset === 0 ? [atm] : [atm - offset * target.step, atm + offset * target.step]) {
          if (k <= 0) continue;
          const closes = await fetchCloses("call", k);
          if (closes.size > 0) seeded = true;
          for (const day of closes.keys()) if (day < firstListed) firstListed = day;
        }
      }
      let low = Infinity;
      let high = -Infinity;
      for (let d = firstListed > first ? firstListed : first; d <= endDay; d = shiftDay(d, 1)) {
        const s = spotByDay.get(d);
        if (s === undefined) continue;
        low = Math.min(low, Number(s));
        high = Math.max(high, Number(s));
      }
      const strikes = seeded && Number.isFinite(low) ? await scanExpiry(fetchCloses, { low, high }, target.step) : new Map<number, StrikeCloses>();
      const requests = src.requests() - before;
      if (strikes.size === 0 && expiry <= today) {
        // Delta lists a daily on every date, so a past date with no strike is the venue answering nothing: not remembered, tried again next run
        deps.logger.warn({ venue: target.venue, asset: target.asset, expiry, requests }, "chain history: a past expiry came back without a strike; will retry");
        totals.undated += 1;
        totals.requests += requests;
        continue;
      }
      const rows = rowsForExpiry({ venue: target.venue, asset: target.asset, expiry, strikes, spotByDay, settlementHourUtc: target.settlementHourUtc, skipDays, firstDay: first, lastDay });
      const doneAt = new Date(nowFn());
      await deps.db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += BATCH) await tx.insert(chainEod).values(rows.slice(i, i + BATCH)).onConflictDoNothing();
        await tx
          .insert(chainEodBackfill)
          .values({ venue: target.venue, asset: target.asset, expiry, strikes: strikes.size, rows: rows.length, requests, doneAt })
          .onConflictDoUpdate({ target: [chainEodBackfill.venue, chainEodBackfill.asset, chainEodBackfill.expiry], set: { strikes: strikes.size, rows: rows.length, requests, doneAt } });
      });
      totals.expiries += 1;
      totals.rows += rows.length;
      totals.requests += requests;
      if (strikes.size > 0) deps.logger.info({ venue: target.venue, asset: target.asset, expiry, strikes: strikes.size, rows: rows.length, requests }, "chain history: expiry reconstructed");
    } catch (e) {
      // one symbol failing three times must not stall the run: nothing of this expiry is written (the rows and the
      // watermark share one transaction), the next run tries it again
      totals.failed += 1;
      totals.requests += src.requests() - before;
      deps.logger.warn({ venue: target.venue, asset: target.asset, expiry, err: e instanceof Error ? e.message : String(e) }, "chain history: expiry failed; will retry");
    }
  }
  return totals;
}

/**
 * The targets of the enabled venues: one per underlying with a known strike step on a venue whose public REST offers
 * candles (Delta); a data-only venue without candles (Deribit) yields none.
 */
export function historyTargets(venues: readonly Venue[], restFor: (venue: Venue) => VenueRest | null, horizonDays: number): HistoryTarget[] {
  const out: HistoryTarget[] = [];
  for (const venue of venues) {
    const rest = restFor(venue);
    const candles = rest?.candles;
    if (!rest || !candles) continue;
    const adapter = getVenue(venue);
    for (const [asset, step] of Object.entries(HISTORY_STRIKE_STEP) as [Underlying, number][]) {
      out.push({
        venue,
        asset,
        step,
        settlementHourUtc: adapter.calendar.settlementHourUtc(asset),
        horizonDays,
        source: { candles: (p) => candles(p) },
        markSymbol: (kind, strike, expiry) => `${MARK_PREFIX}${adapter.symbols.formatOption(kind, asset, String(strike), expiry)}`,
        spotSymbol: `${MARK_PREFIX}${adapter.symbols.perpetual(asset)}`,
      });
    }
  }
  return out;
}

/**
 * Run the backfill for every target now (one after another, never two at once) and again every `HISTORY_REPEAT_MS`
 * while the process lives; a run that failed anywhere (the spot series, or any expiry) is repeated after
 * `retryMs` instead. Returns the stop function.
 */
export function startEodHistoryBackfill(deps: HistoryDeps, targets: readonly HistoryTarget[], repeatMs = HISTORY_REPEAT_MS, retryMs = HISTORY_RETRY_MS): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    let failed = false;
    for (const target of targets) {
      if (stopped) return;
      try {
        const totals = await backfillEodHistory(deps, target, () => stopped);
        if (totals.failed > 0 || totals.undated > 0) failed = true;
        deps.logger.info({ venue: target.venue, asset: target.asset, ...totals }, "chain history: run complete");
      } catch (e) {
        failed = true;
        deps.logger.warn({ venue: target.venue, asset: target.asset, err: e instanceof Error ? e.message : String(e) }, "chain history: run failed; retried soon");
      }
    }
    if (!stopped) {
      timer = setTimeout(() => void run(), failed ? retryMs : repeatMs);
      timer.unref?.();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// Chain history from the venue's candles (ADR-098; HC-SH-140): the settlement-hour bar names the day, the strike scan
// finds the listed ladder and stops at its edges, rows never land on a recorded day or before the settlement bar has
// closed, the live recorder still writes (and replaces) a reconstructed day, the watermark makes a second run cheap,
// a past date without a strike or a failing symbol is retried instead of remembered, an unexpired expiry is rescanned
// after a week, and the read side tells a reconstructed day from a recorded or mixed one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Instrument, Quote } from "@hapiecoin/schema";
import type { Candle } from "@hapiecoin/venues";
import { and, count, eq } from "drizzle-orm";
import {
  HISTORY_EMPTY_RUN,
  HISTORY_RESCAN_DAYS,
  HISTORY_WINDOW_DAYS,
  backfillEodHistory,
  closesAtHour,
  closesOf,
  expiryDaysDescending,
  historyTargets,
  lastFinalDay,
  rowsForExpiry,
  scanExpiry,
  scanStands,
  startEodHistoryBackfill,
  throttledSource,
  type CandleSource,
  type HistoryTarget,
} from "./chain-eod-history.js";
import { clearEodMemo, eodDays, recordEodIfDue } from "./chain-eod.js";
import { chainEod, chainEodBackfill } from "./db/schema.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const HOUR = 3_600_000;
const DAY = 86_400_000;
const utc = (day: string, hour: number, minute = 0) => Date.parse(`${day}T00:00:00Z`) + hour * HOUR + minute * 60_000;
const bar = (ms: number, close: number): Candle => ({ time: ms / 1000, open: String(close), high: String(close), low: String(close), close: String(close), volume: "1" });
const noSleep = () => Promise.resolve();
const quiet = { info: () => undefined, warn: () => undefined };
const m = (entries: [string, string][]) => new Map<string, string>(entries);

/** A venue in miniature: a spot series over six days and three BTC expiries listed for different spans, served as hourly bars at 10:00, 11:00 and 12:00 UTC. */
const SPOT: Record<string, number> = { "2026-11-01": 80_000, "2026-11-02": 80_500, "2026-11-03": 81_000, "2026-11-04": 80_800, "2026-11-05": 81_200, "2026-11-06": 81_100 };
const LISTED: Record<string, { strikes: number[]; from: string; to: string }> = {
  "031126": { strikes: [79_600, 79_800, 80_000, 80_200, 80_400, 80_600, 80_800, 81_000, 81_200], from: "2026-11-01", to: "2026-11-03" },
  "051126": { strikes: [80_200, 80_400, 80_600, 80_800, 81_000, 81_200, 81_400, 81_600, 81_800], from: "2026-11-03", to: "2026-11-05" },
  "071126": { strikes: [80_600, 80_800, 81_000, 81_200, 81_400, 81_600], from: "2026-11-05", to: "2026-11-07" },
};
const NOW = utc("2026-11-06", 13);
/** Every calendar day after today up to the 100-day lookahead: the dates the fake never listed, scanned once and remembered. */
const FUTURE_DATES = expiryDaysDescending("2026-11-07", "2027-02-14").length;

function fakeSource(opts: { failing?: string | undefined } = {}): CandleSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    candles: ({ symbol, start, end }) => {
      calls.push(symbol);
      if (opts.failing && symbol === opts.failing) return Promise.reject(new Error("502 from the venue"));
      const out: Candle[] = [];
      const within = (ms: number) => ms >= start * 1000 && ms <= end * 1000 && ms <= NOW;
      if (/^MARK:(BTC|ETH)USD$/.test(symbol)) {
        for (const [day, close] of Object.entries(SPOT)) for (const h of [10, 11, 12]) if (within(utc(day, h))) out.push(bar(utc(day, h), close));
        return Promise.resolve(out);
      }
      const sym = symbol.match(/^MARK:([CP])-BTC-(\d+)-(\d{6})$/);
      if (!sym) return Promise.resolve(out);
      const listed = LISTED[sym[3]!];
      const strike = Number(sym[2]);
      if (!listed || !listed.strikes.includes(strike)) return Promise.resolve(out);
      for (const [day, spot] of Object.entries(SPOT)) {
        if (day < listed.from || day > listed.to) continue;
        for (const h of [10, 11, 12]) {
          const ms = utc(day, h);
          if (!within(ms) || (day === listed.from && h < 12)) continue; // listed at 12:00 on its first day, as Delta lists the next daily
          const intrinsic = sym[1] === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
          out.push(bar(ms, intrinsic + 50 + h)); // the hour shows in the close so the 11:00 bar can be told apart
        }
      }
      return Promise.resolve(out);
    },
  };
}

const code = (expiry: string) => `${expiry.slice(8, 10)}${expiry.slice(5, 7)}${expiry.slice(2, 4)}`;
const btcTarget = (source: CandleSource, horizonDays = 5): HistoryTarget => ({
  venue: "delta_india",
  asset: "BTC",
  step: 200,
  settlementHourUtc: 12,
  horizonDays,
  source,
  markSymbol: (kind, strike, expiry) => `MARK:${kind === "call" ? "C" : "P"}-BTC-${strike}-${code(expiry)}`,
  spotSymbol: "MARK:BTCUSD",
});
const ethTargetOf = (source: CandleSource): HistoryTarget => ({ ...btcTarget(source), asset: "ETH", step: 10, spotSymbol: "MARK:ETHUSD", markSymbol: (kind, strike, expiry) => `MARK:${kind === "call" ? "C" : "P"}-ETH-${strike}-${code(expiry)}` });
const deps = (now = NOW, logger: { info(o: object, msg: string): void; warn(o: object, msg: string): void } = quiet) => ({ db: t.db, logger, now: () => now, sleep: noSleep });

describe("HC-SH-140 the pure helpers", () => {
  it("closesAtHour keeps the venue's string of the bar that ends at the settlement hour, keyed by day, else the open of the bar that starts at it", () => {
    const bars = [bar(utc("2026-11-01", 10), 1), bar(utc("2026-11-01", 11), 2), bar(utc("2026-11-01", 12), 3), bar(utc("2026-11-02", 11, 5), 9), bar(utc("2026-11-02", 15), 7), bar(utc("2026-11-03", 12), 4)];
    // 1 Nov: the 11:00 bar's close; 3 Nov: no 11:00 bar (listed at the hour), so the 12:00 bar's open; 2 Nov: a bar off the hour is not a mark
    expect([...closesAtHour(bars, 12)]).toEqual([["2026-11-01", "2"], ["2026-11-03", "4"]]);
    expect([...closesAtHour(bars, 16)]).toEqual([["2026-11-02", "7"]]);
    expect([...closesAtHour([{ ...bar(utc("2026-11-01", 11), 1), close: "0.0000001" }], 12)]).toEqual([["2026-11-01", "0.0000001"]]); // no float round trip
  });

  it("expiryDaysDescending walks every calendar day from the last to the first, and lastFinalDay is the day whose settlement bar has closed", () => {
    expect(expiryDaysDescending("2026-10-30", "2026-11-02")).toEqual(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(lastFinalDay(utc("2026-11-06", 12, 30), 12)).toBe("2026-11-05"); // the 11:00 bar of today closed, but the live recorder's pass has not run yet
    expect(lastFinalDay(utc("2026-11-06", 13), 12)).toBe("2026-11-06");
    expect(lastFinalDay(utc("2026-11-06", 16, 59), 16)).toBe("2026-11-05");
  });

  it("scanExpiry asks for every strike in the range, walks outward until the empty run, and never asks for the put of a strike whose call has no candles", async () => {
    const listed = new Set([80_000, 80_400]); // 80 200 sits inside the range and is not listed (a coarser ladder)
    const asked: string[] = [];
    const strikes = await scanExpiry(
      (kind, k) => {
        asked.push(`${kind}:${k}`);
        return Promise.resolve(listed.has(k) ? m([["2026-11-01", "1"]]) : m([]));
      },
      { low: 80_050, high: 80_350 },
      200,
      2,
    );
    expect([...strikes.keys()]).toEqual([80_000, 80_400]);
    expect(asked).toEqual(["call:80000", "put:80000", "call:80200", "call:80400", "put:80400", "call:79800", "call:79600", "call:80600", "call:80800"]);
  });

  it("rowsForExpiry leaves out the settlement day, recorded days, days outside [firstDay, lastDay] and days without a spot, keeps the venue's strings and stamps the settlement hour", () => {
    const strikes = new Map([[80_000, { call: m([["2026-10-31", "5"], ["2026-11-01", "1"], ["2026-11-02", "2"], ["2026-11-03", "3"]]), put: m([["2026-11-01", "4"], ["2026-11-02", "6"]]) }]]);
    const spotByDay = m([["2026-10-31", "1"], ["2026-11-01", "80000"], ["2026-11-02", "80500"]]);
    const rows = rowsForExpiry({ venue: "delta_india", asset: "BTC", expiry: "2026-11-04", strikes, spotByDay, settlementHourUtc: 12, skipDays: new Set(["2026-11-03"]), firstDay: "2026-11-01", lastDay: "2026-11-01" });
    expect(rows.map((r) => `${r.day} ${r.kind} ${r.mark} ${r.spot} ${r.source}`)).toEqual(["2026-11-01 call 1 80000 candles", "2026-11-01 put 4 80000 candles"]);
    expect(rows[0]!.ts.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(rows[0]!.markIv).toBeNull();
    const open = rowsForExpiry({ venue: "delta_india", asset: "BTC", expiry: "2026-11-04", strikes, spotByDay, settlementHourUtc: 12, skipDays: new Set(), lastDay: "2026-11-02" });
    expect(open.map((r) => r.day)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-01", "2026-11-02"]); // no firstDay: the day before the horizon is kept
  });

  it("closesOf reads a second window only when the first reaches back to its own start", async () => {
    const asked: number[] = [];
    const longSeries: CandleSource = { candles: ({ start, end }) => { asked.push(end - start); return Promise.resolve([bar(start * 1000 + 11 * HOUR - ((start * 1000) % DAY), 1)]); } };
    const end = utc("2026-11-06", 13);
    const closes = await closesOf(longSeries, "X", end - 2 * HISTORY_WINDOW_DAYS * DAY, end, 12);
    expect(asked).toHaveLength(2);
    expect(closes.size).toBe(2);
    const shortSeries: CandleSource = { candles: () => Promise.resolve([bar(utc("2026-11-05", 11), 1)]) };
    expect((await closesOf(shortSeries, "X", end - 2 * HISTORY_WINDOW_DAYS * DAY, end, 12)).size).toBe(1);
    // a series that begins on the day after the window's first day also reaches back: the second window is read
    asked.length = 0;
    const edge: CandleSource = { candles: ({ start }) => { asked.push(start); return Promise.resolve([bar(start * 1000 - ((start * 1000) % DAY) + DAY + 11 * HOUR, 1)]); } };
    await closesOf(edge, "X", end - 2 * HISTORY_WINDOW_DAYS * DAY, end, 12);
    expect(asked).toHaveLength(2);
  });

  it("throttledSource spaces requests, makes three attempts and gives up on the third failure", async () => {
    let clock = 0;
    const slept: number[] = [];
    let failures = 2;
    const inner: CandleSource = {
      candles: () => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("503"));
        }
        return Promise.resolve([]);
      },
    };
    const src = throttledSource(inner, { minGapMs: 270, now: () => clock, sleep: (ms) => { slept.push(ms); clock += ms; return Promise.resolve(); } });
    await src.candles({ symbol: "X", resolution: "1h", start: 0, end: 1 });
    expect(slept).toEqual([2_000, 4_000]); // two pauses between three attempts; the first call waits for no gap
    expect(src.requests()).toBe(3);
    await src.candles({ symbol: "X", resolution: "1h", start: 0, end: 1 });
    expect(slept.at(-1)).toBe(270);
    failures = 3;
    await expect(src.candles({ symbol: "X", resolution: "1h", start: 0, end: 1 })).rejects.toThrow("503");
  });

  it("scanStands: a scan on or after the expiry date stands for good, a recent one stands a week, none stands when missing", () => {
    expect(scanStands("2026-11-03", undefined, NOW)).toBe(false);
    expect(scanStands("2026-11-03", utc("2026-11-04", 1), NOW)).toBe(true);
    expect(scanStands("2026-11-03", utc("2026-11-03", 0, 1), NOW + 30 * DAY)).toBe(true); // on the expiry date itself: the last writable day has settled
    expect(scanStands("2026-11-07", utc("2026-11-06", 1), NOW)).toBe(true);
    expect(scanStands("2026-11-07", utc("2026-11-06", 1), NOW + (HISTORY_RESCAN_DAYS + 1) * DAY)).toBe(false);
  });

  it("historyTargets builds Delta's mark symbols for BTC and ETH and skips a venue without candles", () => {
    const withCandles = { products: () => Promise.resolve([]), tickers: () => Promise.resolve([]), candles: () => Promise.resolve([]) };
    const targets = historyTargets(["delta_india", "deribit"], (v) => (v === "delta_india" ? withCandles : { products: () => Promise.resolve([]), tickers: () => Promise.resolve([]) }), 365);
    expect(targets.map((x) => `${x.venue} ${x.asset} ${x.step} ${x.settlementHourUtc} ${x.spotSymbol}`)).toEqual(["delta_india BTC 200 12 MARK:BTCUSD", "delta_india ETH 10 12 MARK:ETHUSD"]);
    expect(targets[0]!.markSymbol("call", 85_000, "2026-10-02")).toBe("MARK:C-BTC-85000-021026");
    expect(targets[1]!.markSymbol("put", 2_600, "2026-10-02")).toBe("MARK:P-ETH-2600-021026");
  });
});

describe("HC-SH-140 the backfill against the database", () => {
  const rowsOn = async (day: string, source?: "snapshot" | "candles") =>
    (await t.db.select({ n: count() }).from(chainEod).where(and(eq(chainEod.asset, "BTC"), eq(chainEod.day, day), ...(source ? [eq(chainEod.source, source)] : []))))[0]!.n;
  const marksOf = async (asset: "BTC" | "ETH") => t.db.select({ expiry: chainEodBackfill.expiry, strikes: chainEodBackfill.strikes, rows: chainEodBackfill.rows }).from(chainEodBackfill).where(eq(chainEodBackfill.asset, asset));

  it("writes every reconstructed day inside the horizon, never on a recorded day, marks the listed and the future expiries done, and retries a past date that came back empty", async () => {
    // a day the snapshotter recorded live: the backfill must not touch it
    await t.db.insert(chainEod).values({ venue: "delta_india", asset: "BTC", day: "2026-11-04", expiry: "2026-11-05", strike: "80800", kind: "call", mark: "123", markIv: "0.5", spot: "80800", ts: new Date(utc("2026-11-04", 12)) });
    const source = fakeSource();
    const totals = await backfillEodHistory(deps(), btcTarget(source));
    // the two listed past expiries and every future date are done; the three past dates the fake never listed (2, 4 and 6 Nov) are not remembered, because Delta lists a daily on every date
    expect(totals).toMatchObject({ expiries: 2 + FUTURE_DATES, skipped: 0, undated: 3, failed: 0, rows: 78 });
    expect(await rowsOn("2026-11-01", "candles")).toBe(18); // 9 strikes of the 3 Nov expiry, both sides, from the 12:00 bar's open on the listing day
    expect(await rowsOn("2026-11-02", "candles")).toBe(18);
    expect(await rowsOn("2026-11-03", "candles")).toBe(18); // the 5 Nov expiry; the 3 Nov expiry settles that day and is not quoted
    expect(await rowsOn("2026-11-04")).toBe(1); // recorded live: untouched
    expect(await rowsOn("2026-11-05", "candles")).toBe(12); // the 7 Nov expiry, 6 strikes
    expect(await rowsOn("2026-11-06", "candles")).toBe(12); // today at 13:00: the settlement bar has closed
    const [row] = await t.db.select().from(chainEod).where(and(eq(chainEod.asset, "BTC"), eq(chainEod.day, "2026-11-02"), eq(chainEod.strike, "80000"), eq(chainEod.kind, "put")));
    expect(row).toMatchObject({ expiry: "2026-11-03", mark: "61", spot: "80500", source: "candles", markIv: null }); // the 11:00 bar: intrinsic 0 + 50 + 11
    expect(row!.ts.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    const [listingDay] = await t.db.select({ mark: chainEod.mark }).from(chainEod).where(and(eq(chainEod.asset, "BTC"), eq(chainEod.day, "2026-11-01"), eq(chainEod.strike, "80000"), eq(chainEod.kind, "put")));
    expect(listingDay).toEqual({ mark: "62" }); // listed at 12:00 that day: the 12:00 bar's open
    const marks = await marksOf("BTC");
    expect(marks.find((x) => x.expiry === "2026-11-03")).toMatchObject({ strikes: 9, rows: 36 });
    expect(marks.find((x) => x.expiry === "2026-11-07")).toMatchObject({ strikes: 6, rows: 24 });
    expect(marks.find((x) => x.expiry === "2026-12-25")).toMatchObject({ strikes: 0, rows: 0 }); // an unlisted future date is scanned once and remembered
    expect(marks.find((x) => x.expiry === "2026-11-04")).toBeUndefined(); // a past date without a strike is not

    // the read side tells the days apart
    clearEodMemo();
    const days = await eodDays(t.db, "delta_india", "BTC");
    expect(days.map((d) => `${d.day}:${d.source}`)).toEqual(["2026-11-01:candles", "2026-11-02:candles", "2026-11-03:candles", "2026-11-04:snapshot", "2026-11-05:candles", "2026-11-06:candles"]);
    expect(days[0]!.expiries[0]!.rows.map((r) => r.strike)).toEqual(LISTED["031126"]!.strikes);

    // the second run: the spot series, the seeds of the three past dates, and nothing for the expiries that stand
    source.calls.length = 0;
    const again = await backfillEodHistory(deps(), btcTarget(source));
    expect(again).toMatchObject({ expiries: 0, rows: 0, skipped: 2 + FUTURE_DATES, undated: 3, failed: 0 });
    expect(source.calls.some((s) => /-(031126|051126|071126)$/.test(s))).toBe(false);
    expect(source.calls[0]).toBe("MARK:BTCUSD");

    // a week later the still-open 7 Nov expiry is rescanned, the settled ones are not
    source.calls.length = 0;
    const later = await backfillEodHistory(deps(NOW + (HISTORY_RESCAN_DAYS + 1) * DAY), btcTarget(source, 13));
    expect(source.calls.some((s) => s.endsWith("-071126"))).toBe(true);
    expect(source.calls.some((s) => s.endsWith("-031126") || s.endsWith("-051126"))).toBe(false);
    expect(later.expiries).toBeGreaterThan(0);
  });

  it("the live recorder still writes a day the backfill reconstructed and replaces the reconstructed rows with its own; the day then reads as mixed", async () => {
    const inst: Instrument = { id: "delta_india:C-BTC-80000-031126", venue: "delta_india", symbol: "C-BTC-80000-031126", underlying: "BTC", kind: "call", strike: "80000", expiry: "2026-11-03", contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
    const at = new Date(utc("2026-11-02", 12, 4));
    const quote: Quote = { instrumentId: inst.id, ts: at.getTime(), mark: "70", markIv: 0.55, oi: "1", spot: "80490" };
    const written = await recordEodIfDue(t.db, { venue: "delta_india", asset: "BTC", at, spot: 80_490, instruments: [inst], quotes: [quote], settlementHourUtc: 12 });
    expect(written.written).toBe(1);
    const [call] = await t.db.select().from(chainEod).where(and(eq(chainEod.asset, "BTC"), eq(chainEod.day, "2026-11-02"), eq(chainEod.strike, "80000"), eq(chainEod.kind, "call")));
    expect(call).toMatchObject({ mark: "70", markIv: "0.55", spot: "80490", source: "snapshot" });
    expect(call!.ts.toISOString()).toBe("2026-11-02T12:04:00.000Z");
    expect(await rowsOn("2026-11-02", "candles")).toBe(17); // the put and the other strikes stay reconstructed
    clearEodMemo();
    expect((await eodDays(t.db, "delta_india", "BTC")).find((d) => d.day === "2026-11-02")?.source).toBe("mixed");
    // the day is now recorded: a later pass does not write it again
    expect((await recordEodIfDue(t.db, { venue: "delta_india", asset: "BTC", at: new Date(utc("2026-11-02", 12, 9)), spot: 80_000, instruments: [inst], quotes: [quote], settlementHourUtc: 12 })).written).toBe(0);
  });

  it("a symbol that fails three times leaves nothing of its expiry behind and the run goes on; the next run picks it up", async () => {
    const own = await createTestApp();
    try {
      const failing = fakeSource({ failing: "MARK:P-BTC-80800-051126" });
      const warned: string[] = [];
      const totals = await backfillEodHistory({ db: own.db, logger: { info: () => undefined, warn: (_o, msg) => warned.push(msg) }, now: () => NOW, sleep: noSleep }, btcTarget(failing));
      expect(totals).toMatchObject({ failed: 1, expiries: 1 + FUTURE_DATES });
      expect(warned).toContain("chain history: expiry failed; will retry");
      const marks = await own.db.select({ expiry: chainEodBackfill.expiry }).from(chainEodBackfill);
      expect(marks.some((x) => x.expiry === "2026-11-05")).toBe(false);
      expect((await own.db.select({ n: count() }).from(chainEod).where(eq(chainEod.expiry, "2026-11-05")))[0]!.n).toBe(0);
      const healthy = fakeSource();
      const next = await backfillEodHistory({ db: own.db, logger: quiet, now: () => NOW, sleep: noSleep }, btcTarget(healthy));
      expect(next).toMatchObject({ failed: 0, expiries: 1 });
      expect(healthy.calls.some((s) => s.endsWith("-051126"))).toBe(true);
      expect(healthy.calls.some((s) => s.endsWith("-031126"))).toBe(false);
    } finally {
      await own.close();
    }
  });

  it("a date without candles at the money is probed out to the empty run on each side before it counts as unlisted", async () => {
    const source = fakeSource();
    const totals = await backfillEodHistory(deps(), ethTargetOf(source));
    const seedsPerDate = 1 + 2 * HISTORY_EMPTY_RUN;
    const futureSeeds = source.calls.filter((s) => s.endsWith(`-${code("2026-12-25")}`));
    expect(futureSeeds).toHaveLength(seedsPerDate);
    expect(futureSeeds.every((s) => s.startsWith("MARK:C-ETH-"))).toBe(true);
    expect(totals).toMatchObject({ expiries: FUTURE_DATES, undated: 5, failed: 0, rows: 0 }); // 2 to 6 Nov: past dates without a strike, retried next run
  });

  it("stops between expiries when asked, and the job starter runs a target to completion then stops cleanly", async () => {
    const source = fakeSource();
    const ethTarget = ethTargetOf(source);
    let asked = 0;
    const totals = await backfillEodHistory(deps(), ethTarget, () => asked++ > 0);
    expect(totals.expiries + totals.skipped).toBe(1);

    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const logs: string[] = [];
    const stop = startEodHistoryBackfill(
      { db: t.db, logger: { info: (_o, msg) => { logs.push(msg); if (msg.includes("run complete")) done(); }, warn: (_o, msg) => logs.push(msg) }, now: () => NOW, sleep: noSleep },
      [ethTarget],
      60 * 60_000,
    );
    await finished;
    stop();
    expect(logs).toContain("chain history: run complete");
    expect((await t.db.select({ n: count() }).from(chainEodBackfill).where(eq(chainEodBackfill.asset, "ETH")))[0]!.n).toBe(FUTURE_DATES);
  });

  it("throws when the venue has no spot candles, so nothing is dated from nothing", async () => {
    const empty: CandleSource = { candles: () => Promise.resolve([]) };
    await expect(backfillEodHistory(deps(), { ...btcTarget(empty), asset: "XAUT" })).rejects.toThrow("no spot candles");
  });
});

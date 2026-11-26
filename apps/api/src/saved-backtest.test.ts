// The backtest of a saved strategy in the app (ADR-144; HC-TR-287, HC-TR-288), on a real Postgres with a recorded
// chain and a candle source made in the test: never the exchange. A week of evenings on BTC around 83,200; on one of
// them the price jumps after the entry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAVED_REFUSALS, type SavedBacktestRun, SavedDefinition, type SavedStrategy, savedPlaybookOf } from "@hapiecoin/schema";
import type { Candle } from "@hapiecoin/venues";
import { eq } from "drizzle-orm";
import { autopilotSavedBacktests, chainEod, markCandles } from "./db/schema.js";
import { CANDLES_PER_REQUEST, type MarkSource, RESOLUTION_MS, barsOf, marksOf, spacedSource } from "./mark-candles.js";
import { skipText } from "./autopilot.js";
import { BacktestRefused, backtestRefusal, backtestSaved, resolutionOf } from "./saved-backtest.js";
import { RUN_STALE_MS } from "./saved-backtest-runs.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 27, 0, 0, 0);
const day = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString().slice(0, 10);
/** The spot: 83,200, but 3 % up from 20:00 UTC on the 23rd until that night's expiry has settled. */
const spotAt = (ms: number): number => (ms >= Date.UTC(2026, 8, 23, 20) && ms <= Date.UTC(2026, 8, 24, 12) ? 85_700 : 83_200);
/** An option's mark: what it is worth in the money, plus a time value that falls away from the money and to nothing at its expiry. */
const markAt = (kind: "call" | "put", strike: number, settleMs: number, ms: number): number => {
  const s = spotAt(ms);
  const left = Math.max(0, Math.min(1, (settleMs - ms) / (20 * HOUR)));
  return Math.max(kind === "call" ? s - strike : strike - s, 0) + 400 * Math.exp(-Math.abs(strike - s) / 1500) * Math.sqrt(left);
};
/** The candles the venue would answer with, newest first as it does; `calls` counts the requests. */
function source(hole: (symbol: string, closeMs: number) => boolean = () => false): MarkSource & { calls: { symbol: string; bars: number }[] } {
  const calls: { symbol: string; bars: number }[] = [];
  return {
    calls,
    candles: ({ symbol, resolution, start, end }) => {
      const step = RESOLUTION_MS[resolution] / 1000;
      const option = /^MARK:([CP])-BTC-(\d+)-(\d{2})(\d{2})(\d{2})$/.exec(symbol);
      const settle = option ? Date.UTC(2000 + Number(option[5]), Number(option[4]) - 1, Number(option[3]), 12) : Infinity;
      const out: Candle[] = [];
      for (let time = Math.ceil(start / step) * step; time <= end; time += step) {
        const closeMs = (time + step) * 1000;
        // an option has no bars after its settlement; the venue pads a series asked for beyond the present
        if (closeMs > settle || hole(symbol, closeMs)) continue;
        const close = option ? markAt(option[1] === "C" ? "call" : "put", Number(option[2]), settle, closeMs) : spotAt(closeMs);
        out.push({ time, open: "0", high: "0", low: "0", close: close.toFixed(2), volume: "0" });
      }
      calls.push({ symbol, bars: out.length });
      return Promise.resolve(out.reverse());
    },
  };
}
const sell = (kind: "call" | "put") => ({ kind, side: "sell" as const, by: "pct" as const, value: 1 });
const EVENING = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [sell("put"), sell("call")], exits: { legStop: 2, takeProfitOfCredit: 0.5 } });
const row = (definition: SavedDefinition) => ({ id: "sv_bt", name: "Evening strangle", summary: "Sell both sides each evening.", definition });

beforeAll(async () => {
  t = await createTestApp();
  // the chain as it was recorded at each day's settlement: the next two expiries on a 200 grid
  const rows: (typeof chainEod.$inferInsert)[] = [];
  for (let n = 15; n <= 26; n++)
    // (and, further out, the expiry of the 26th, as a weekly would be listed)
    for (const expiry of [...new Set([day(n + 1), day(n + 2), ...(n < 26 ? [day(26)] : [])])])
      for (let k = 80_000; k <= 86_400; k += 200)
        for (const kind of ["call", "put"] as const) {
          const ts = Date.UTC(2026, 8, n, 12);
          rows.push({ venue: "delta_india", asset: "BTC", day: day(n), expiry, strike: String(k), kind, mark: markAt(kind, k, Date.parse(`${expiry}T12:00:00Z`), ts).toFixed(2), spot: String(spotAt(ts)), ts: new Date(ts), source: "candles" });
        }
  for (let i = 0; i < rows.length; i += 500) await t.db.insert(chainEod).values(rows.slice(i, i + 500));
});
afterAll(() => t.close());

describe("HC-TR-287 the exchange's candles, downloaded once and kept", () => {
  it("HC-TR-287 a series is asked of the venue once: the same range, and one inside it, are read from the table; a wider one is downloaded as one range", async () => {
    const src = source();
    const key = { venue: "delta_india" as const, symbol: "MARK:C-BTC-84000-220926", resolution: "5m" as const };
    const from = Date.UTC(2026, 8, 21, 16);
    const to = Date.UTC(2026, 8, 22, 12);
    const first = await marksOf(t.db, src, key, from, to, NOW);
    // the price that held at an instant is the close of the bar that ends there
    expect(first.get(from + 5 * 60_000)).toBeCloseTo(markAt("call", 84_000, to, from + 5 * 60_000), 2);
    // at its settlement the option is worth nothing: a close of zero is no price and is not kept; nor is anything after
    expect(first.get(to - 5 * 60_000)).toBeGreaterThan(0);
    expect(first.has(to)).toBe(false);
    expect(first.has(to + 5 * 60_000)).toBe(false);
    expect(src.calls).toHaveLength(1);
    await marksOf(t.db, src, key, from, to, NOW);
    await marksOf(t.db, src, key, from + HOUR, to - HOUR, NOW);
    expect(src.calls).toHaveLength(1);
    const wider = await marksOf(t.db, src, key, from - 2 * HOUR, to, NOW);
    expect(src.calls).toHaveLength(2);
    expect(wider.has(from - HOUR)).toBe(true);
    const [held] = await t.db.select().from(markCandles).where(eq(markCandles.symbol, key.symbol));
    expect(held).toMatchObject({ fromMs: from - 2 * HOUR, toMs: to, resolution: "5m" });
    expect(held!.bars.every(([time], i, a) => i === 0 || time > a[i - 1]![0])).toBe(true);
    // only the two hours before were asked for the second time, and what was held stayed
    expect(src.calls[1]!.bars).toBeLessThanOrEqual(2 * 12 + 1);
    expect(wider.get(from + 5 * 60_000)).toBe(first.get(from + 5 * 60_000));
    // a venue that answers with nothing for a later stretch takes nothing away
    const silent: MarkSource = { candles: () => Promise.resolve([]) };
    const after = await marksOf(t.db, silent, key, from - 4 * HOUR, to, NOW);
    expect(after.size).toBe(wider.size);
  });

  it("HC-TR-287 nothing past the present is asked for or kept, a long range goes out in windows, and a close that is not a price is dropped", async () => {
    const src = source();
    const key = { venue: "delta_india" as const, symbol: "MARK:BTCUSD", resolution: "5m" as const };
    const now = Date.UTC(2026, 8, 20, 10, 2);
    const marks = await marksOf(t.db, src, key, now - 10 * DAY, now + DAY, now);
    // ten days of five-minute bars: two windows; the last instant held is the last bar that had closed
    expect(src.calls).toHaveLength(Math.ceil((10 * DAY) / (CANDLES_PER_REQUEST * 5 * 60_000)));
    expect(Math.max(...marks.keys())).toBe(Date.UTC(2026, 8, 20, 10, 0));
    // an empty range asks nothing
    await marksOf(t.db, src, { ...key, symbol: "MARK:ETHUSD" }, now + HOUR, now + 2 * HOUR, now);
    expect(src.calls.some((c) => c.symbol === "MARK:ETHUSD")).toBe(false);
    const candle = (time: number, close: string): Candle => ({ time, open: "0", high: "0", low: "0", close, volume: "0" });
    expect(barsOf([candle(600, "5"), candle(300, "4"), candle(900, "0"), candle(1200, "x"), candle(300, "4.5"), candle(1500, "7")], "5m", 1_799_999)).toEqual([[300, 4.5], [600, 5]]);
  });

  it("HC-TR-287 requests are spaced, a failed one is tried again, and the third failure is the caller's", async () => {
    let clock = 0;
    const slept: number[] = [];
    let fail = 2;
    const inner: MarkSource = { candles: () => (fail-- > 0 ? Promise.reject(new Error("503")) : Promise.resolve([])) };
    const spaced = spacedSource(inner, { minGapMs: 270, now: () => clock, sleep: (ms) => ((clock += ms), slept.push(ms), Promise.resolve()) });
    const ask = () => spaced.candles({ symbol: "MARK:BTCUSD", resolution: "1h", start: 0, end: 1 });
    await ask();
    expect(spaced.requests()).toBe(3);
    expect(slept).toEqual([2000, 4000]);
    await ask();
    expect(slept).toEqual([2000, 4000, 270]);
    fail = 3;
    await expect(ask()).rejects.toThrow("503");
    // two callers at once go out one after the other, the gap between them
    fail = 0;
    const before = slept.length;
    await Promise.all([ask(), ask()]);
    expect(slept.slice(before)).toEqual([270, 270]);
    // the defaults: the gap of the nightly history, the real clock
    expect(spacedSource(inner).requests()).toBe(0);
    await spacedSource({ candles: () => Promise.resolve([]) }, { minGapMs: 0 }).candles({ symbol: "x", resolution: "1h", start: 0, end: 1 });
  });
});

describe("HC-TR-288 a saved strategy backtested in the app", () => {
  it("HC-TR-288 an evening strangle over five days: one trade a day on the strikes 1 % away, each replayed to its exit, and figures after the exchange's fees", async () => {
    const src = source();
    const seen: [number, number][] = [];
    const r = await backtestSaved({ db: t.db, source: src, now: () => NOW, onProgress: (done, total) => (seen.push([done, total]), Promise.resolve()) }, row(EVENING), { from: day(21), to: day(25) });
    expect(r).toMatchObject({ from: day(21), to: day(25), resolution: "5m", noEntry: {} });
    expect(seen).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
    expect(r.trades.map((x) => [x.entryAt, x.expiry])).toEqual([21, 22, 23, 24, 25].map((n) => [new Date(Date.UTC(2026, 8, n, 16)).toISOString(), day(n + 1)]));
    // 1 % from 83,200 on the 200 grid: the 82,400 put and the 84,000 call, at the price of the entry instant
    for (const x of r.trades) {
      expect(x.legs.map((l) => [l.side, l.kind, l.strike, l.lots])).toEqual([["sell", "put", 82_400, 100], ["sell", "call", 84_000, 100]]);
      expect(x.legs[1]!.price).toBeCloseTo(markAt("call", 84_000, Date.parse(`${x.expiry}T12:00:00Z`), Date.parse(x.entryAt)), 2);
      expect(x.net).toBeCloseTo(x.gross - x.fees, 2);
      expect(x.fees).toBeGreaterThan(0);
    }
    // the quiet evenings: the time value runs off and half the premium is taken; the evening of the jump the call is stopped
    const quiet = r.trades.filter((x) => x.expiry !== day(24));
    expect(quiet.every((x) => x.reason === "target" && x.events.map((e) => e.kind).join() === "target" && x.net > 0)).toBe(true);
    const jump = r.trades.find((x) => x.expiry === day(24))!;
    expect(jump.events.map((e) => e.kind)).toEqual(["leg_stop", "settled"]);
    expect(jump.events[0]!.at).toBe(new Date(Date.UTC(2026, 8, 23, 20, 0)).toISOString());
    expect(jump.net).toBeLessThan(0);
    // the figures are those trades after fees
    const nets = r.trades.map((x) => x.net);
    expect(r.figures).toEqual({ mean: Number((nets.reduce((a, b) => a + b, 0) / 5).toFixed(2)), per: "day", positivePct: 80, worst: jump.net, samples: 5, basis: `HapieCoin backtest, ${day(21)} to ${day(25)}: 5-minute mark prices from Delta Exchange India, the exchange's fees counted, fills at the bar's price with no slippage.` });
    expect(r.notes.slice(0, 3)).toEqual(["Fills are at the price of the bar: no bid and ask, no slippage.", "Prices are 5 minutes apart: a level touched and left inside a bar is not seen, and an exit is booked at the bar's price, not at its level.", "The strikes on offer at an entry are the ones recorded at the last settlement before it."]);
    expect(r.barsJudged).toBeGreaterThan(0);
    // the spot and two options an evening were asked of the venue; a second run asks nothing
    // (one call of the 22nd was already kept by the test above)
    expect(new Set(src.calls.map((c) => c.symbol)).size).toBe(1 + 2 * 5 - 1);
    const again = source();
    const second = await backtestSaved({ db: t.db, source: again, now: () => NOW }, row(EVENING), { from: day(21), to: day(25) });
    expect(again.calls).toEqual([]);
    expect(second.figures).toEqual(r.figures);
  });

  it("HC-TR-288 what stops an entry is counted by its reason: an expiry not settled yet, one traded already, a trade still held, a plan the prices refuse", async () => {
    const src = source();
    const deps = { db: t.db, source: src, now: () => NOW };
    // no period given: back from yesterday as far as the recording goes; the 26th's expiry settles after "now"
    const open = await backtestSaved(deps, row(EVENING));
    expect([open.from, open.to]).toEqual([day(15), day(26)]);
    expect(open.noEntry).toEqual({ "Its expiry has not settled yet": 1 });
    expect(open.trades).toHaveLength(11);
    expect(open.notes).toContain(`The recorded history starts on ${day(15)}: the period asked for began earlier.`);
    expect(open.notes).toContain("1 entry day whose expiry had not settled yet is left out.");
    expect(open.notes).toContain("An entry is tried on each bar of the window's first hour and then once an hour; Autopilot itself looks every few minutes.");
    expect(open.notes).toContain("The spot, the settlement price included, is the mark price of the perpetual; sizes are in the exchange's lot.");
    // held to settlement with no exit, entered any time of day once per expiry on the second expiry out: while a trade
    // is held nothing is entered, and the hour it settles the next one is, as the engine would on its next pass
    const held = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, minDte: 1.2, maxDte: 3, exits: {} })), { from: day(21), to: day(24) });
    expect(held.trades.map((x) => [x.entryAt, x.expiry])).toEqual([[new Date(Date.UTC(2026, 8, 21, 0)).toISOString(), day(22)], [new Date(Date.UTC(2026, 8, 22, 12)).toISOString(), day(24)], [new Date(Date.UTC(2026, 8, 24, 12)).toISOString(), day(26)]]);
    expect(held.noEntry).toEqual({ "Holds a trade already: one at a time for a strategy and coin": 1 });
    expect(held.trades.every((x) => x.reason === "expired")).toBe(true);
    expect(held.figures).toMatchObject({ per: "trade", samples: 3 });
    // once per expiry, on the expiry further out, closed at 11:30 AM IST the same morning: the next days would take
    // that expiry again, and do not
    const once = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, minDte: 2.6, maxDte: 12, exits: { exitHourUtc: 6 } })), { from: day(21), to: day(23) });
    expect(once.resolution).toBe("1h");
    expect(once.trades.map((x) => [x.entryAt, x.expiry, x.reason, x.closedAt])).toEqual([[new Date(Date.UTC(2026, 8, 21, 0)).toISOString(), day(26), "squared_off", new Date(Date.UTC(2026, 8, 21, 6)).toISOString()]]);
    expect(once.noEntry).toEqual({ "Already traded this expiry": 2 });
    expect(once.notes[1]).toBe("Prices are an hour apart: a level touched and left inside a bar is not seen, and an exit is booked at the bar's price, not at its level.");
    // a bought spread whose target the fees would eat: no plan, said with the engine's own reason
    const thin = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, legs: [{ kind: "call", side: "buy", by: "strikes", value: 0 }, { kind: "call", side: "sell", by: "strikes", value: 1 }], exits: { targetOfMax: 0.99 } })), { from: day(21), to: day(21) });
    expect(thin.trades).toEqual([]);
    expect(thin.figures).toBeNull();
    expect(Object.keys(thin.noEntry)).toEqual(["The fees are larger than what is left of the trade above its target"]);
  });

  it("HC-TR-288 a strategy or a period the app cannot judge is refused with the reason, never given figures", async () => {
    const deps = { db: t.db, source: source(), now: () => NOW };
    const ranked = SavedDefinition.parse({ ...EVENING, conditions: { ivRank: { min: 50, lookbackDays: 90 } } });
    expect(backtestRefusal(ranked)).toBe("It enters on a volatility rank, which the recorded history cannot judge far enough back. Enter its backtest figures by hand.");
    expect(backtestRefusal(EVENING)).toBeNull();
    await expect(backtestSaved(deps, row(ranked))).rejects.toThrow(BacktestRefused);
    await expect(backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, assets: ["XAUT"] })))).rejects.toThrow("There is no recorded price history for its coins yet.");
    await expect(backtestSaved(deps, row(EVENING), { from: day(26), to: day(20) })).rejects.toThrow("The period has no recorded price history.");
    // a period longer than one run takes is shortened to its end, and says so
    const long = await backtestSaved(deps, row(EVENING), { from: "2020-01-01", to: day(25) });
    expect(long.from).toBe(day(15));
    // five-minute prices for the next expiries, hourly ones for anything held longer
    expect([resolutionOf(EVENING), resolutionOf(SavedDefinition.parse({ ...EVENING, cadence: "weekly", weekdayUtc: 5, minDte: 6.5, maxDte: 7.5 })), resolutionOf(SavedDefinition.parse({ ...EVENING, minDte: 14, maxDte: 400, oncePerExpiry: true }))]).toEqual(["5m", "1h", "1h"]);
  });

  it("HC-TR-288 legs chosen by premium are priced at the entry itself, and one side is left out after a move, as the engine does", async () => {
    const deps = { db: t.db, source: source(), now: () => NOW };
    // 20:00 UTC on the 23rd, right after a 3 % rise over four hours: only the put is sold, the one priced nearest 250
    // at that instant (85,200, five hundred under the new price), not the one the noon recording would point to
    const byPremium = SavedDefinition.parse({ ...EVENING, fromHourUtc: 20, toHourUtc: 21, legs: [{ kind: "put", side: "sell", by: "premium", value: 250 }, { kind: "call", side: "sell", by: "premium", value: 250 }], moveSide: { hours: 4, pct: 2 }, exits: { legStop: 2 } });
    const r = await backtestSaved(deps, row(byPremium), { from: day(23), to: day(23) });
    expect(r.noEntry).toEqual({});
    expect(r.trades).toHaveLength(1);
    const [trade] = r.trades;
    expect(trade!.legs).toEqual([{ kind: "put", side: "sell", strike: 85_200, lots: 100, price: expect.closeTo(markAt("put", 85_200, Date.UTC(2026, 8, 24, 12), Date.UTC(2026, 8, 23, 20)), 2) as number }]);
    expect([trade!.spot, trade!.reason]).toEqual([85_700, "expired"]);
    expect(trade!.gross).toBeCloseTo(trade!.legs[0]!.price * 0.1, 1);
    // on a quiet evening both sides are sold
    const quiet = await backtestSaved(deps, row(byPremium), { from: day(21), to: day(21) });
    expect(quiet.trades[0]!.legs.map((l) => l.kind)).toEqual(["put", "call"]);
    // the same rule with strikes by per cent: the day of the move is traded, on the put alone, and not lost for the
    // want of a price on the side that is left out
    const byPct = SavedDefinition.parse({ ...byPremium, legs: [sell("put"), sell("call")] });
    const moved = await backtestSaved(deps, row(byPct), { from: day(23), to: day(23) });
    expect(moved.noEntry).toEqual({});
    expect(moved.trades.map((x) => x.legs.map((l) => [l.kind, l.strike]))).toEqual([[["put", 84_800]]]);
    // a premium so small that thirty strikes out are still dearer: no nearer strike is sold in its place
    const tiny = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, legs: [{ kind: "put", side: "sell", by: "premium", value: 0.2 }] })), { from: day(21), to: day(21) });
    expect(tiny.trades).toEqual([]);
    expect(tiny.noEntry).toEqual({ "The options were not priced far enough from the money for its premium": 1 });
    expect(tiny.notes).toContain("1 of 1 entry days had no usable price and are not in the figures.");
  });

  it("HC-TR-288 a weekly strategy enters on its day only and its figures are a week's; conditions that are not met, strikes off the ladder and an expiry out of range are counted, with nothing downloaded", async () => {
    const src = source();
    const deps = { db: t.db, source: src, now: () => NOW };
    // Monday the 21st, the expiry of the 26th: one trade in the week, on hourly prices, held to its settlement
    const weekly = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, cadence: "weekly", weekdayUtc: 1, minDte: 4, maxDte: 6, exits: {} })), { from: day(21), to: day(25) });
    expect(weekly.trades.map((x) => [x.entryAt, x.expiry, x.reason])).toEqual([[new Date(Date.UTC(2026, 8, 21, 16)).toISOString(), day(26), "expired"]]);
    expect(weekly).toMatchObject({ resolution: "1h", noEntry: {}, figures: { per: "week", samples: 1 } });
    const asked = src.calls.length;
    // the price is never above its own flat average
    const trend = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, conditions: { sma: { days: 3, side: "above" } } })), { from: day(21), to: day(22) });
    expect(trend.noEntry).toEqual({ [skipText("noSignal")]: 2 });
    const far = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, legs: [{ kind: "put", side: "sell", by: "pct", value: 20 }] })), { from: day(21), to: day(21) });
    expect(far.noEntry).toEqual({ "Its strikes are not on the recorded ladder": 1 });
    const near = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, maxDte: 0.6 })), { from: day(21), to: day(21) });
    expect(near.noEntry).toEqual({ "No expiry in its range on that day": 1 });
    const none = await backtestSaved(deps, row(SavedDefinition.parse({ ...EVENING, minDte: 30, maxDte: 40 })), { from: day(21), to: day(21) });
    expect(none.noEntry).toEqual({ [skipText("noExpiry")]: 1 });
    expect(src.calls.length).toBe(asked);
    expect([trend, far, near, none].every((x) => x.figures === null && x.trades.length === 0)).toBe(true);
  });

  it("HC-TR-288 holes in the prices: an entry waits for the first bar with a spot and a price for every leg, a bar without one is counted, and a coin with no recorded chain is said", async () => {
    await t.db.delete(markCandles);
    const at = (h: number, m: number, n = 21) => Date.UTC(2026, 8, n, h, m);
    // no spot at 16:00, no call price at 16:05 and at 18:00, no spot at the settlement itself
    const src = source((symbol, closeMs) => (symbol === "MARK:BTCUSD" && (closeMs === at(16, 0) || closeMs === at(12, 0, 22))) || (symbol === "MARK:C-BTC-84800-220926" && (closeMs === at(16, 5) || closeMs === at(18, 0))));
    const wide = SavedDefinition.parse({ ...EVENING, assets: ["BTC", "ETH"], legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: { legStop: 2 } });
    const r = await backtestSaved({ db: t.db, source: src, now: () => NOW }, row(wide), { from: day(21), to: day(21) });
    expect(r.trades.map((x) => [x.asset, x.entryAt, x.reason, x.barsSkipped])).toEqual([["BTC", new Date(at(16, 10)).toISOString(), "expired", 1]]);
    // the settlement's own spot is missing: the day's recorded one stands in
    expect(r.trades[0]!.gross).toBeCloseTo((r.trades[0]!.legs[0]!.price + r.trades[0]!.legs[1]!.price) * 0.1, 1);
    expect(r.noEntry).toEqual({ "No recorded chain before the entry": 1 });
    expect(r.barsSkipped).toBe(1);
    expect(r.notes).toContain(`1 of ${r.barsJudged + 1} bars had no price for an open leg and were not judged.`);
    expect(r.notes).toContain("The trades of BTC, ETH are counted together.");
    expect(r.notes).toContain("1 of 2 entry days had no usable price and are not in the figures.");
    // several coins: the figures are per trade, never "a day"
    expect(r.figures).toMatchObject({ per: "trade", samples: 1 });
    // a window with no price at all for a leg: the day is given up after its tries
    const dark = await backtestSaved({ db: t.db, source: source((symbol) => symbol.startsWith("MARK:P-")), now: () => NOW }, row(SavedDefinition.parse({ ...wide, assets: ["BTC"], legs: [{ kind: "put", side: "sell", by: "pct", value: 3 }] })), { from: day(22), to: day(22) });
    expect(dark.noEntry).toEqual({ "No price for a leg at the entry": 1 });
    // and an expiry that has not settled by the present is not replayed
    const late = await backtestSaved({ db: t.db, source: source(), now: () => Date.UTC(2026, 8, 24, 0, 2) }, row(EVENING), { from: day(23), to: day(23) });
    expect(late.noEntry).toEqual({ "Its expiry has not settled yet": 1 });
  });
});

describe("HC-TR-288 the backtest in the app through the admin routes", () => {
  const BASE = "/v1/admin/autopilot-strategies";
  let admin: string;
  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
  const post = (path: string, body?: unknown, cookie = admin) => t.request(path, { cookie, method: "POST", ...(body === undefined ? {} : { json: body }) });
  const create = async (name: string, definition: unknown = EVENING) => json<SavedStrategy>(await post(BASE, { name, summary: "Sell both sides each evening.", definition }));
  const runs = async (id: string) => (await json<{ items: SavedBacktestRun[] }>(await t.request(`${BASE}/${id}/backtests`, { cookie: admin }))).items;
  const why = async (res: Response) => (await json<{ message: string }>(res)).message;
  /** The run once its work in the background has ended. */
  const ended = async (id: string): Promise<SavedBacktestRun> => {
    for (let i = 0; i < 400; i++) {
      const [latest] = await runs(id);
      if (latest && latest.status !== "running") return latest;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the run did not end");
  };
  const PERIOD = { from: day(21), to: day(25) };

  it("HC-TR-288 a run is started, reports its progress and ends with figures, trades and its limits; its figures go on the strategy marked as computed in the app, and stay so through a change of name", async () => {
    admin = await t.adminCookie();
    t.deps.markSource = source();
    const made = await create("Evening strangle, backtested here");
    expect(await runs(made.id)).toEqual([]);
    const res = await post(`${BASE}/${made.id}/backtests`, PERIOD);
    expect(res.status).toBe(202);
    const started = await json<SavedBacktestRun>(res);
    expect(started).toMatchObject({ strategyId: made.id, status: "running", progress: { done: 0, total: 0 }, figures: null, trades: [], current: true, resolution: "5m", finishedAt: null });
    const run = await ended(made.id);
    expect(run).toMatchObject({ id: started.id, status: "done", progress: { done: 5, total: 5 }, from: day(21), to: day(25), error: null, current: true, figures: { per: "day", samples: 5, positivePct: 80 } });
    expect(run.trades).toHaveLength(5);
    expect(run.notes[0]).toBe("Fills are at the price of the bar: no bid and ask, no slippage.");
    expect(run.finishedAt).not.toBeNull();
    // used: the strategy is backtested, with the run's period, prices and limits beside the numbers
    const used = await json<SavedStrategy>(await post(`${BASE}/${made.id}/backtests/${run.id}/use`));
    expect(used.stage).toBe("backtested");
    expect(used.backtest).toEqual({ ...run.figures, run: { id: run.id, from: day(21), to: day(25), resolution: "5m", notes: run.notes } });
    expect(savedPlaybookOf({ ...used, backtest: used.backtest }).evidence.claim).toContain(`backtested in the app on 5-minute prices, ${day(21)} to ${day(25)}`);
    // a form sends the figures back as typed (no mark of a run): unchanged figures keep the mark, changed ones are the admin's own
    const patch = (body: unknown) => t.request(`${BASE}/${made.id}`, { cookie: admin, method: "PATCH", json: body });
    const renamed = await json<SavedStrategy>(await patch({ name: "Evening strangle, renamed", backtest: run.figures }));
    expect(renamed.backtest?.run?.id).toBe(run.id);
    // (and their date is still the day they were computed, not the day of the rename)
    expect(renamed.backtestAt).toBe(used.backtestAt);
    expect((await patch({ backtest: { ...run.figures, run: { id: run.id, from: day(21), to: day(25), resolution: "5m", notes: [] } } })).status).toBe(400);
    const typed = await json<SavedStrategy>(await patch({ backtest: { ...run.figures, mean: 99 } }));
    expect(typed.backtest).toEqual({ ...run.figures, mean: 99 });
    // new settings: the run is no longer of this strategy's settings, and its figures are not put on it
    await patch({ definition: { ...EVENING, lots: 50 } });
    expect((await runs(made.id))[0]).toMatchObject({ id: run.id, current: false });
    const stale = await post(`${BASE}/${made.id}/backtests/${run.id}/use`);
    expect([stale.status, await why(stale)]).toEqual([409, SAVED_REFUSALS.backtestStale]);
  });

  it("HC-TR-288 what is refused: one run at a time, a strategy the app cannot judge, a run with no trade, an unknown run, a retired strategy, a server without the price history, anyone but an admin", async () => {
    // a source that waits (nothing is kept yet, so the run has to ask it): the first run is still working when the second is asked for
    await t.db.delete(markCandles);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = source();
    t.deps.markSource = { candles: async (params) => (await gate, slow.candles(params)) };
    const made = await create("One at a time");
    expect((await post(`${BASE}/${made.id}/backtests`, PERIOD)).status).toBe(202);
    const second = await post(`${BASE}/${made.id}/backtests`, PERIOD);
    expect([second.status, await why(second)]).toEqual([409, SAVED_REFUSALS.backtestRunning]);
    // a run that stopped reporting has lost its process: it reads as failed, and another may start
    const [working] = await runs(made.id);
    expect((await post(`${BASE}/${made.id}/backtests/${working!.id}/use`)).status).toBe(404);
    await t.db.update(autopilotSavedBacktests).set({ updatedAt: new Date(Date.now() - RUN_STALE_MS - 1000) }).where(eq(autopilotSavedBacktests.id, working!.id));
    expect((await runs(made.id))[0]).toMatchObject({ status: "failed", error: "The backtest was interrupted before it finished: run it again" });
    release();
    await ended(made.id);
    t.deps.markSource = source();

    const ranked = await create("On a volatility rank", { ...EVENING, conditions: { ivRank: { min: 50, lookbackDays: 90 } } });
    const refused = await post(`${BASE}/${ranked.id}/backtests`, {});
    expect([refused.status, await why(refused)]).toEqual([409, "It enters on a volatility rank, which the recorded history cannot judge far enough back. Enter its backtest figures by hand."]);
    expect(await runs(ranked.id)).toEqual([]);

    // no trade in the period: done, without figures, and nothing to use
    const far = await create("Strikes off the ladder", { ...EVENING, legs: [{ kind: "put", side: "sell", by: "pct", value: 20 }] });
    await post(`${BASE}/${far.id}/backtests`, { from: day(21), to: day(21) });
    const empty = await ended(far.id);
    expect(empty).toMatchObject({ status: "done", figures: null, trades: [], noEntry: { "Its strikes are not on the recorded ladder": 1 } });
    const none = await post(`${BASE}/${far.id}/backtests/${empty.id}/use`);
    expect([none.status, await why(none)]).toEqual([409, SAVED_REFUSALS.backtestEmpty]);
    expect((await post(`${BASE}/${far.id}/backtests/bt_nothing/use`)).status).toBe(404);
    expect((await post(`${BASE}/sv_nothing/backtests`, {})).status).toBe(404);
    expect((await t.request(`${BASE}/sv_nothing/backtests`, { cookie: admin })).status).toBe(404);

    // a period with no recorded history: the run ends failed, with the reason
    await post(`${BASE}/${far.id}/backtests`, { from: day(26), to: day(20) });
    expect(await ended(far.id)).toMatchObject({ status: "failed", error: "The period has no recorded price history." });
    // the venue does not answer: failed, said plainly, the cause in the log and not on the screen
    t.deps.markSource = { candles: () => Promise.reject(new Error("ECONNRESET 10.0.0.1")) };
    const broken = await create("The venue is down", { ...EVENING, lots: 10 });
    await t.db.delete(markCandles);
    await post(`${BASE}/${broken.id}/backtests`, { from: day(21), to: day(21) });
    expect(await ended(broken.id)).toMatchObject({ status: "failed", error: "The backtest could not be completed: the price history could not be read. Try again later." });

    t.deps.markSource = undefined;
    const off = await post(`${BASE}/${made.id}/backtests`, PERIOD);
    expect([off.status, await why(off)]).toEqual([503, "The exchange's price history is not available on this server"]);
    const trader = await t.signUp("backtest-trader@hapiecoin.test");
    expect((await post(`${BASE}/${made.id}/backtests`, PERIOD, trader.cookie)).status).toBe(403);
    expect((await t.request(`${BASE}/${made.id}/backtests`, { cookie: trader.cookie })).status).toBe(403);
    expect((await post(`${BASE}/${far.id}/backtests/${empty.id}/use`, undefined, trader.cookie)).status).toBe(403);
  });

  it("HC-TR-288 a strategy on paper stays on paper when a run's figures are put on it; a retired one takes none", async () => {
    t.deps.markSource = source();
    const made = await create("On paper, tested again");
    await t.request(`${BASE}/${made.id}`, { cookie: admin, method: "PATCH", json: { backtest: { mean: 1, per: "day", positivePct: 50, worst: -1, samples: 1, basis: "typed" } } });
    expect((await json<SavedStrategy>(await post(`${BASE}/${made.id}/publish`))).stage).toBe("paper");
    await post(`${BASE}/${made.id}/backtests`, PERIOD);
    const run = await ended(made.id);
    const used = await json<SavedStrategy>(await post(`${BASE}/${made.id}/backtests/${run.id}/use`));
    expect([used.stage, used.backtest?.run?.id, used.backtest?.samples]).toEqual(["paper", run.id, 5]);
    await post(`${BASE}/${made.id}/retire`);
    const late = await post(`${BASE}/${made.id}/backtests/${run.id}/use`);
    expect([late.status, await why(late)]).toEqual([409, SAVED_REFUSALS.retired]);
  });
});

// Strategy backtest over recorded end-of-day chains (ADR-077; HC-TR-184): entries on every recorded day, settlement
// at intrinsic on the first day at or after each leg's expiry, open trades marked from recorded marks or the model,
// and the statistics the tab shows.
import { describe, expect, it } from "vitest";
import { type EodDay, type EodRow, atmIndexOf, atmIvOf, foldsOf, maxDrawdownOf, runBacktest, statsOf } from "./backtest.js";
import { fillFee, settlementFee } from "./fees.js";
import { DELTA_RULE as DELTA_INDIA_FEE_RULE } from "./fees.test.js";
import { black76Price } from "./black76.js";
import { calendarFor, yearFractionOf } from "./calendar.js";
import { type StrategyTemplate, templateByName } from "./templates.js";

const cal = calendarFor(12);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // 1 Sep 2026 12:00Z, the settlement hour
const day = (n: number) => new Date(T0 + n * DAY).toISOString().slice(0, 10);
const tpl = (name: string): StrategyTemplate => {
  const t = templateByName(name);
  if (!t) throw new Error(name);
  return t;
};

/** A ladder of five strikes around 80 000 priced as a rough function of moneyness, spot and IV. */
function ladder(spot: number, iv: number, strikes = [78_000, 79_000, 80_000, 81_000, 82_000], dropSide?: "call" | "put"): EodRow[] {
  return strikes.map((strike) => {
    const call = { mark: Math.max(spot - strike, 0) + 500 * iv * 2, iv };
    const put = { mark: Math.max(strike - spot, 0) + 500 * iv * 2, iv: iv + 0.02 };
    return { strike, ...(dropSide === "call" ? {} : { call }), ...(dropSide === "put" ? {} : { put }) };
  });
}
/** Five days with one expiry on day 4 (settles at T0 + 4 days) and a far expiry on day 30. */
function days(n = 5, spots = [80_000, 80_400, 79_800, 81_000, 82_500]): EodDay[] {
  return Array.from({ length: n }, (_, i) => {
    const spot = spots[i] ?? 80_000 + i * 100;
    const iv = 0.4 + i * 0.01;
    return { day: day(i), ts: T0 + i * DAY, spot, expiries: [{ expiry: day(4), rows: ladder(spot, iv) }, { expiry: day(30), rows: ladder(spot, iv + 0.05) }] };
  });
}
const opts = { lots: 10, unitsPerLot: 0.001, minDte: 1, calendar: cal };

describe("HC-TR-184 runBacktest", () => {
  it("counts the days reconstructed from candles (ADR-098) apart from the recorded ones, and a day without IV still enters and settles", () => {
    const ds = days();
    ds[0]!.source = "candles";
    ds[1]!.source = "candles";
    ds[2]!.source = "mixed";
    for (const e of ds[0]!.expiries) for (const row of e.rows) {
      if (row.call) row.call = { mark: row.call.mark };
      if (row.put) row.put = { mark: row.put.mark };
    }
    const r = runBacktest(templateByName("Buy Call")!, ds, opts);
    expect(r.coverage.days).toBe(5);
    expect(r.coverage.reconstructedDays).toBe(2);
    expect(r.trades[0]!.entryDay).toBe(day(0));
  });

  it("a bought call entered each day settles at intrinsic on the expiry day; the equity curve and stats follow the closed trades", () => {
    // a backfilled expiry day stamped before the settlement hour still settles that day: the date decides
    const early = days().map((x, i) => (i === 4 ? { ...x, ts: x.ts - 3_600_000 } : x));
    expect(runBacktest(tpl("Buy Call"), early, opts).trades[0]).toMatchObject({ exitDay: day(4), status: "closed" });
    const r = runBacktest(tpl("Buy Call"), days(), opts);
    // entries on days 0..2 (day 3 has 1 day left: minDte 1 keeps it; day 4 has 0 days and no other expiry with a day left besides the far one)
    expect(r.trades.map((t) => [t.entryDay, t.expiry, t.status])).toEqual([
      [day(0), day(4), "closed"],
      [day(1), day(4), "closed"],
      [day(2), day(4), "closed"],
      [day(3), day(4), "closed"],
      [day(4), day(30), "open"],
    ]);
    const first = r.trades[0]!;
    expect(first.legs).toHaveLength(1);
    const leg = first.legs[0]!;
    expect(leg).toMatchObject({ kind: "call", side: "buy", strike: 80_000, expiry: day(4), quantity: 0.01 });
    expect(leg.exitPrice).toBe(2_500); // settled at intrinsic on day 4: 82 500 − 80 000
    expect(first.pnl).toBeCloseTo(0.01 * (2_500 - leg.price), 10);
    expect(first.entryCost).toBeCloseTo(0.01 * leg.price, 10);
    expect(first.exitDay).toBe(day(4));
    expect(first.daysHeld).toBe(4);
    expect(r.equity.map((e) => e.day)).toEqual([day(0), day(1), day(2), day(3), day(4)]);
    expect(r.equity[3]!.pnl).toBe(0); // nothing realised before the expiry day
    expect(r.equity[4]!.pnl).toBeCloseTo(r.trades.slice(0, 4).reduce((s, t) => s + t.pnl, 0), 10);
    expect(r.stats.trades).toBe(4);
    expect(r.stats.total).toBeCloseTo(r.equity[4]!.pnl, 10);
    expect(r.stats.wins + r.stats.losses).toBeLessThanOrEqual(4);
    expect(r.stats.best).toBe(Math.max(...r.trades.slice(0, 4).map((t) => t.pnl)));
    expect(r.stats.worst).toBe(Math.min(...r.trades.slice(0, 4).map((t) => t.pnl)));
    expect(r.stats.median).not.toBeNull();
    expect(r.coverage).toEqual({ firstDay: day(0), lastDay: day(4), days: 5, reconstructedDays: 0, entries: 5, skipped: { noExpiry: 0, noFit: 0, noSignal: 0 }, openTrades: 1, modelledTrades: 0, exits: { settled: 4, target: 0, stop: 0, time: 0, inert: 0 } });
  });

  it("an open trade is marked from the recorded mark of the same instrument, and modelled with Black-76 at the ATM IV when the day's chain lacks it", () => {
    const d = days(3);
    // the far expiry is the target once minDte is 10: entries on every day, all still open on day 2
    const r = runBacktest(tpl("Bull Call Spread"), d, { ...opts, minDte: 10 });
    expect(r.trades.every((t) => t.status === "open" && t.expiry === day(30))).toBe(true);
    const t0 = r.trades[0]!;
    expect(t0.modelled).toBe(false);
    const lastRows = d[2]!.expiries[1]!.rows;
    expect(t0.legs.map((l) => l.exitPrice)).toEqual([lastRows[2]!.call!.mark, lastRows[4]!.call!.mark]); // ATM and +2 rows on the last day
    expect(r.coverage.openTrades).toBe(3);
    expect(r.stats.trades).toBe(0);
    expect(r.stats.winRate).toBeNull();
    expect(r.stats.profitFactor).toBeNull();
    // the last day lists the far expiry with a different ladder: the entry strikes are missing there → modelled
    d[2]!.expiries[1]!.rows = ladder(d[2]!.spot, 0.5, [70_000, 90_000]);
    const m = runBacktest(tpl("Bull Call Spread"), d, { ...opts, minDte: 10 });
    expect(m.trades[0]!.modelled).toBe(true);
    const T = yearFractionOf(cal, d[2]!.ts, day(30));
    expect(m.trades[0]!.legs[0]!.exitPrice).toBeCloseTo(black76Price(d[2]!.spot, 80_000, T, 0.51, true), 8); // ATM IV of the new ladder: mean of 0.5 and 0.52
    expect(m.coverage.modelledTrades).toBe(2); // the last day itself no longer fits an entry on the two-strike ladder
    expect(m.coverage.skipped.noFit).toBe(1);
    // no IV anywhere on the last day: the entry IV of the leg is used
    d[2]!.expiries[1]!.rows = [{ strike: 70_000, call: { mark: 1 }, put: { mark: 1 } }];
    const e = runBacktest(tpl("Bull Call Spread"), d, { ...opts, minDte: 10 });
    expect(e.trades[0]!.legs[0]!.exitPrice).toBeCloseTo(black76Price(d[2]!.spot, 80_000, T, 0.45, true), 8);
    // the far expiry is not listed at all on the last day: still modelled, from the entry IV
    d[2]!.expiries = [d[2]!.expiries[0]!];
    const g = runBacktest(tpl("Bull Call Spread"), d, { ...opts, minDte: 10 });
    expect(g.trades[0]!.modelled).toBe(true);
  });

  it("a calendar settles each leg at its own expiry, a perpetual rides to the exit day, and a sold structure has a negative entry cost", () => {
    const d = days(5);
    const c = runBacktest(tpl("Long Calendar with Calls"), d, { ...opts, minDte: 1, to: day(0) });
    expect(c.trades).toHaveLength(1);
    const t = c.trades[0]!;
    expect(t.status).toBe("open"); // the far leg has not settled by day 4
    expect([...t.legs.map((l) => l.expiry)].sort()).toEqual([day(4), day(30)]);
    expect(t.legs.find((l) => l.expiry === day(4))!.exitPrice).toBe(2_500); // near leg settled on day 4 at intrinsic
    expect(t.exitDay).toBe(day(4));
    const perp = runBacktest(tpl("Long Perp"), d, { ...opts, to: day(0) }); // a perpetual alone has nothing to hold to
    expect(perp.trades).toHaveLength(0);
    expect(perp.coverage.skipped.noFit).toBe(1);
    const sold = runBacktest(tpl("Sell Put"), d, { ...opts, to: day(0) });
    expect(sold.trades[0]!.entryCost).toBeLessThan(0);
    expect(sold.trades[0]!.pnl).toBeCloseTo(-sold.trades[0]!.entryCost - 0.01 * Math.max(80_000 - 82_500, 0), 10);
  });

  it("skips days without an expiry far enough out or where the template does not fit, honours from / to, and handles no days", () => {
    const d = days(5);
    const far = runBacktest(tpl("Buy Call"), d, { ...opts, minDte: 60 });
    expect(far.trades).toHaveLength(0);
    expect(far.coverage.skipped).toEqual({ noExpiry: 5, noFit: 0, noSignal: 0 });
    const WIDE: StrategyTemplate = { name: "Wide", category: "Others", description: "four rows above ATM", legs: [{ kind: "call", side: "buy", k: 4 }], risk: "defined" };
    const wide = runBacktest(WIDE, d, { ...opts, from: day(1), to: day(2) }); // reaches past a five-strike ladder
    expect(wide.coverage.skipped.noFit).toBe(2);
    expect(wide.coverage.entries).toBe(0);
    const ranged = runBacktest(tpl("Buy Call"), d, { ...opts, from: day(1), to: day(2) });
    expect(ranged.trades.map((t) => t.entryDay)).toEqual([day(1), day(2)]);
    const none = runBacktest(tpl("Buy Call"), [], opts);
    expect(none).toMatchObject({ trades: [], equity: [], coverage: { firstDay: null, lastDay: null, days: 0, entries: 0 } });
    expect(none.stats).toEqual({ trades: 0, wins: 0, losses: 0, winRate: null, total: 0, grossTotal: 0, totalFees: 0, average: null, median: null, best: null, worst: null, maxDrawdown: 0, profitFactor: null });
  });

  it("helpers: ATM index and IV, drawdown, median of an even count", () => {
    const rows = ladder(80_100, 0.4);
    expect(atmIndexOf(rows, 80_100)).toBe(2); // the last strike at or below the spot, as the Builder places it
    expect(atmIndexOf(rows, 80_999)).toBe(2);
    expect(atmIndexOf(rows, 77_000)).toBe(0);
    expect(atmIndexOf([], 80_000)).toBe(-1);
    expect(atmIvOf(rows, 80_100)).toBeCloseTo(0.41, 10);
    expect(atmIvOf([{ strike: 80_000 }], 80_000)).toBeNull();
    expect(atmIvOf([], 80_000)).toBeNull();
    expect(maxDrawdownOf([0, 5, 2, 8, 1, 9])).toBe(7);
    expect(maxDrawdownOf([])).toBe(0);
    // an even number of closed trades gives the mean of the middle two
    const d = days(5);
    const r = runBacktest(tpl("Buy Call"), d, { ...opts, from: day(0), to: day(3) });
    const pnls = r.trades.map((t) => t.pnl).sort((a, b) => a - b);
    expect(r.stats.median).toBeCloseTo((pnls[1]! + pnls[2]!) / 2, 10);
    expect(r.stats.profitFactor === null || r.stats.profitFactor > 0).toBe(true);
  });
});

describe("HC-TR-184 runBacktest edge cases", () => {
  it("a future in an open structure is marked at the last spot, a put leg is marked from its own side, and a spread settles both legs on the same day", () => {
    const d = days(3);
    const covered = runBacktest(tpl("Covered Call"), d, { ...opts, minDte: 10, to: day(0) });
    expect(covered.trades[0]!.status).toBe("open");
    expect(covered.trades[0]!.legs.find((l) => l.kind === "future")!.exitPrice).toBe(d[2]!.spot);
    const put = runBacktest(tpl("Sell Put"), d, { ...opts, minDte: 10, to: day(0) });
    expect(put.trades[0]!.legs[0]!.exitPrice).toBe(d[2]!.expiries[1]!.rows[2]!.put!.mark);
    const spread = runBacktest(tpl("Bull Call Spread"), days(5), { ...opts, to: day(0) });
    expect(spread.trades[0]).toMatchObject({ status: "closed", exitDay: day(4) });
    expect(spread.trades[0]!.legs.map((l) => l.exitPrice)).toEqual([2_500, 500]); // 82 500 against 80 000 and 82 000
  });

  it("a ladder missing one side refuses the templates that need it, and losing trades give a profit factor", () => {
    const d = days(5).map((x) => ({ ...x, expiries: x.expiries.map((e) => ({ ...e, rows: ladder(x.spot, 0.4, undefined, "call") })) }));
    const noCalls = runBacktest(tpl("Buy Call"), d, opts);
    expect(noCalls.coverage.skipped.noFit).toBe(5);
    const puts = runBacktest(tpl("Sell Put"), d, { ...opts, to: day(3) });
    expect(puts.trades).toHaveLength(4);
    const losing = runBacktest(tpl("Sell Call"), days(5), { ...opts, to: day(3) }); // the spot rallies to 82 500: every sold ATM call loses
    expect(losing.stats.losses).toBe(4);
    expect(losing.stats.profitFactor).toBe(0);
    expect(losing.stats.maxDrawdown).toBeCloseTo(-losing.stats.total, 10);
  });
});

describe("HC-TR-184 runBacktest fallbacks", () => {
  it("without any IV an open leg is worth its intrinsic value; a closed structure with a perpetual marks it at the exit spot; a ladder without puts refuses put templates", () => {
    const strip = (x: EodDay): EodDay => ({ ...x, expiries: x.expiries.map((e) => ({ ...e, rows: e.rows.map((r) => ({ strike: r.strike, call: r.call ? { mark: r.call.mark } : undefined, put: r.put ? { mark: r.put.mark } : undefined })) })) });
    const d = days(3).map(strip);
    d[2]!.expiries = [d[2]!.expiries[0]!];
    const r = runBacktest(tpl("Bull Call Spread"), d, { ...opts, minDte: 10, to: day(0) });
    expect(r.trades[0]!.modelled).toBe(true);
    expect(r.trades[0]!.legs.map((l) => l.exitPrice)).toEqual([Math.max(d[2]!.spot - 80_000, 0), Math.max(d[2]!.spot - 82_000, 0)]);
    const covered = runBacktest(tpl("Covered Call"), days(5), { ...opts, to: day(0) });
    expect(covered.trades[0]).toMatchObject({ status: "closed", exitDay: day(4) });
    expect(covered.trades[0]!.legs.find((l) => l.kind === "future")!.exitPrice).toBe(82_500);
    const noPuts = days(5).map((x) => ({ ...x, expiries: x.expiries.map((e) => ({ ...e, rows: ladder(x.spot, 0.4, undefined, "put") })) }));
    expect(runBacktest(tpl("Sell Put"), noPuts, opts).coverage.skipped.noFit).toBe(5);
  });
});

describe("HC-TR-200 fees in the backtest", () => {
  it("a trade's net P&L is the gross less the entry fills, the exit fills or the in-the-money settlement fee; fees off reproduces the gross engine exactly", () => {
    const gross = runBacktest(tpl("Buy Call"), days(), opts);
    const net = runBacktest(tpl("Buy Call"), days(), { ...opts, fees: DELTA_INDIA_FEE_RULE });
    const g = gross.trades[0]!;
    const n = net.trades[0]!;
    // 10 lots x 0.001 BTC at 80 000: notional 800, premium 4 (the 400 ATM call); settles at 82 500 with 2 500 intrinsic
    const entryFee = fillFee("call", 800, 4, DELTA_INDIA_FEE_RULE);
    const settleFee = settlementFee("call", 825, 25, DELTA_INDIA_FEE_RULE);
    expect(g.fees).toBe(0);
    expect(g.pnl).toBe(g.grossPnl);
    expect(g.exitReason).toBe("settled");
    expect(n.grossPnl).toBeCloseTo(g.grossPnl, 10);
    expect(n.fees).toBeCloseTo(entryFee + settleFee, 10);
    expect(n.pnl).toBeCloseTo(g.pnl - entryFee - settleFee, 10);
    expect(net.stats.totalFees).toBeCloseTo(net.trades.filter((t) => t.status === "closed").reduce((sum, t) => sum + t.fees, 0), 10);
    expect(net.stats.grossTotal).toBeCloseTo(gross.stats.total, 10);
    expect(net.stats.total).toBeCloseTo(net.stats.grossTotal - net.stats.totalFees, 10);
    // an open trade has paid its entry fills only; fees: null is the same as no rule
    expect(net.trades.at(-1)!).toMatchObject({ status: "open", exitReason: "open" });
    expect(net.trades.at(-1)!.fees).toBeCloseTo(fillFee("call", 825, (82_500 - 82_000 + 500 * 0.49 * 2) * 0.01, DELTA_INDIA_FEE_RULE), 6);
    expect(runBacktest(tpl("Buy Call"), days(), { ...opts, fees: null })).toEqual(gross);
  });

  it("a sold leg's fill is charged on the size of its credit and a worthless settlement pays nothing", () => {
    // Sell Call entered on day 2 (spot 79 800, ATM 79 000): the 79 000 call settles in the money at 82 500 and pays
    const r = runBacktest(tpl("Sell Call"), days(), { ...opts, fees: DELTA_INDIA_FEE_RULE, from: day(2), to: day(2) });
    const t = r.trades[0]!;
    expect(t.legs[0]!.strike).toBe(79_000);
    expect(t.fees).toBeCloseTo(fillFee("call", 798, t.legs[0]!.price * 0.01, DELTA_INDIA_FEE_RULE) + settlementFee("call", 825, 35, DELTA_INDIA_FEE_RULE), 10);
    // a bought put that expires worthless pays its entry fill only
    const put = runBacktest(tpl("Buy Put"), days(), { ...opts, fees: DELTA_INDIA_FEE_RULE, from: day(0), to: day(0) });
    expect(put.trades[0]!.legs[0]!.exitPrice).toBe(0);
    expect(put.trades[0]!.fees).toBeCloseTo(fillFee("put", 800, put.trades[0]!.legs[0]!.price * 0.01, DELTA_INDIA_FEE_RULE), 10);
  });
});

describe("HC-TR-201 entry conditions", () => {
  it("the entry waits for the spot above a 2-day average and counts days without enough history or without the signal as no signal", () => {
    const r = runBacktest(tpl("Buy Call"), days(), { ...opts, conditions: { sma: { days: 2, side: "above" } } });
    // day 0 has one recorded spot (no history); day 2 is below its average; days 1, 3 and 4 enter
    expect(r.trades.map((t) => t.entryDay)).toEqual([day(1), day(3), day(4)]);
    expect(r.coverage.skipped.noSignal).toBe(2);
    const below = runBacktest(tpl("Buy Put"), days(), { ...opts, conditions: { sma: { days: 2, side: "below" } } });
    expect(below.trades.map((t) => t.entryDay)).toEqual([day(2)]);
  });

  it("a weekday filter enters only on the chosen UTC weekdays", () => {
    // 1 Sep 2026 is a Tuesday (2); the fixture runs Tuesday to Saturday
    const r = runBacktest(tpl("Buy Call"), days(), { ...opts, conditions: { weekdays: [2, 4] } });
    expect(r.trades.map((t) => t.entryDay)).toEqual([day(0), day(2)]);
    expect(r.coverage.skipped.noSignal).toBe(3);
  });

  it("an IV-rank band needs twenty recorded points before it judges a day and reads the front expiry's ATM IV", () => {
    // five days can never have twenty prior points: every day is no signal
    expect(runBacktest(tpl("Buy Call"), days(), { ...opts, conditions: { ivRank: { min: 0, lookbackDays: 365 } } }).coverage).toMatchObject({ entries: 0, skipped: { noSignal: 5 } });
    // 25 days with IV rising every day: from day 20 on, today's IV is the highest seen, rank 100
    const high = runBacktest(tpl("Buy Call"), days(25), { ...opts, conditions: { ivRank: { min: 90, lookbackDays: 365 } } });
    expect(high.trades.map((t) => t.entryDay)).toEqual([day(20), day(21), day(22), day(23), day(24)]);
    expect(high.coverage.skipped.noSignal).toBe(20);
    const low = runBacktest(tpl("Buy Call"), days(25), { ...opts, conditions: { ivRank: { max: 50, lookbackDays: 365 } } });
    expect(low.trades).toHaveLength(0);
    // a day whose front expiry carries no IV (a reconstructed day) is no signal
    const strip = (row: EodRow): EodRow => ({ strike: row.strike, call: row.call ? { mark: row.call.mark } : undefined, put: row.put ? { mark: row.put.mark } : undefined });
    const blind = days(25).map((x, i) => (i === 24 ? { ...x, expiries: x.expiries.map((e) => ({ ...e, rows: e.rows.map(strip) })) } : x));
    expect(runBacktest(tpl("Buy Call"), blind, { ...opts, conditions: { ivRank: { min: 90, lookbackDays: 365 } } }).trades.map((t) => t.entryDay)).toEqual([day(20), day(21), day(22), day(23)]);
  });
});

describe("HC-TR-202 exit rules", () => {
  it("a target at the full debit closes on the first recorded day the marks reach it, pays the exit fills, and says target", () => {
    // Buy Call at 80 000 for 400: on day 1 (spot 80 400) the call marks 810, a profit of 4.1 on a 4 debit; the profit is unbounded, so the target is a share of the debit
    const r = runBacktest(tpl("Buy Call"), days(), { ...opts, exits: { targetPct: 1 }, fees: DELTA_INDIA_FEE_RULE, from: day(0), to: day(0) });
    const t = r.trades[0]!;
    expect(t).toMatchObject({ exitDay: day(1), exitReason: "target", status: "closed", modelled: false });
    expect(t.legs[0]!.exitPrice).toBeCloseTo(810, 10);
    expect(t.grossPnl).toBeCloseTo(4.1, 10);
    expect(t.fees).toBeCloseTo(fillFee("call", 800, 4, DELTA_INDIA_FEE_RULE) + fillFee("call", 804, 8.1, DELTA_INDIA_FEE_RULE), 10);
    expect(r.coverage.exits).toEqual({ settled: 0, target: 1, stop: 0, time: 0, inert: 0 });
    // a target the marks never reach leaves the trade to settle as before
    expect(runBacktest(tpl("Buy Call"), days(), { ...opts, exits: { targetPct: 100 }, from: day(0), to: day(0) }).trades[0]).toMatchObject({ exitDay: day(4), exitReason: "settled" });
  });

  it("a stop at the full credit closes a sold call on the day the loss reaches it, a time stop closes at the given days to settlement, and a day with a missing mark is not judged", () => {
    const stop = runBacktest(tpl("Sell Call"), days(), { ...opts, exits: { stopPct: 1 }, from: day(0), to: day(0) });
    expect(stop.trades[0]).toMatchObject({ exitDay: day(1), exitReason: "stop" });
    expect(stop.trades[0]!.grossPnl).toBeCloseTo(-4.1, 10);
    // the expiry settles on day 4 at the settlement hour: day 2 is the first recorded day with at most 2 days left
    const time = runBacktest(tpl("Buy Call"), days(), { ...opts, exits: { timeStopDte: 2 }, from: day(0), to: day(0) });
    expect(time.trades[0]).toMatchObject({ exitDay: day(2), exitReason: "time" });
    // without the 80 000 call's mark on day 1 the target is judged next on day 2 (0.2, below) and fires on day 3 (10.3)
    const gap = days().map((x, i) => (i === 1 ? { ...x, expiries: x.expiries.map((e) => ({ ...e, rows: e.rows.map((row) => (row.strike === 80_000 ? { strike: row.strike, put: row.put } : row)) })) } : x));
    expect(runBacktest(tpl("Buy Call"), gap, { ...opts, exits: { targetPct: 1 }, from: day(0), to: day(0) }).trades[0]).toMatchObject({ exitDay: day(3), exitReason: "target" });
    // the nearest leg's settlement day itself is never a rule day
    expect(runBacktest(tpl("Buy Call"), days(), { ...opts, exits: { timeStopDte: 0 }, from: day(0), to: day(0) }).trades[0]).toMatchObject({ exitDay: day(4), exitReason: "settled" });
  });
});

describe("HC-TR-201 / HC-TR-202 the range, the futures leg and an inert rule", () => {
  it("days before `from` are history for a condition but not part of the coverage or the equity", () => {
    // a 3-day average needs two earlier days: with from = day 2 the entry on day 2 is judged on days 0..2
    const r = runBacktest(tpl("Buy Call"), days(), { ...opts, from: day(2), conditions: { sma: { days: 3, side: "below" } } });
    expect(r.coverage).toMatchObject({ firstDay: day(2), lastDay: day(4), days: 3, entries: 1, skipped: { noSignal: 2 } }); // day 2 (79 800 < 80 067) enters; days 3 and 4 are above their averages
    expect(r.trades.map((t) => t.entryDay)).toEqual([day(2)]);
    expect(r.equity.map((e) => e.day)).toEqual([day(2), day(3), day(4)]);
  });

  it("a covered call's perpetual leg pays the taker fee at exit and a stop on a debit spread is a share of the debit", () => {
    const covered = runBacktest(tpl("Covered Call"), days(), { ...opts, minDte: 1, to: day(0), fees: DELTA_INDIA_FEE_RULE });
    const t = covered.trades[0]!;
    const future = t.legs.find((l) => l.kind === "future")!;
    const call = t.legs.find((l) => l.kind !== "future")!;
    // entry: the future's notional at 80 000 and the sold call's premium; exit on day 4 at 82 500: the future pays again, the in-the-money call pays its settlement value
    const expected =
      fillFee("future", 80_000 * future.quantity, 0, DELTA_INDIA_FEE_RULE) +
      fillFee("call", 80_000 * call.quantity, call.price * call.quantity, DELTA_INDIA_FEE_RULE) +
      fillFee("future", 82_500 * future.quantity, 0, DELTA_INDIA_FEE_RULE) +
      settlementFee("call", 82_500 * call.quantity, call.exitPrice * call.quantity, DELTA_INDIA_FEE_RULE);
    expect(t.fees).toBeCloseTo(expected, 10);
    // a call bought on day 1 (spot 80 400, the 80 000 call at 810) loses 390 a unit when day 2 drops the spot to 79 800: a stop at a quarter of the debit fires that day
    const debit = runBacktest(tpl("Buy Call"), days(), { ...opts, minDte: 1, from: day(1), to: day(1), exits: { stopPct: 0.25 } });
    expect(debit.trades[0]).toMatchObject({ entryDay: day(1), exitDay: day(2), exitReason: "stop" });
    expect(debit.trades[0]!.grossPnl).toBeCloseTo(-3.9, 10);
  });

  it("a target on a structure with no base (a near-zero premium and an unbounded payoff) is inert and counted", () => {
    // a long call financed by a short put at the same strike has a net premium near zero and an unbounded payoff both ways
    const synthetic: StrategyTemplate = { ...tpl("Buy Call"), name: "Synthetic", legs: [{ kind: "call", side: "buy", k: 0 }, { kind: "put", side: "sell", k: 0 }] };
    const r = runBacktest(synthetic, days(), { ...opts, minDte: 1, to: day(0), exits: { targetPct: 0.5 } });
    const t = r.trades[0]!;
    expect(Math.abs(t.entryCost)).toBeLessThan(0.01 * 10);
    expect(t.ruleInert).toBe(true);
    expect(t.exitReason).toBe("settled");
    expect(r.coverage.exits.inert).toBe(1);
    // a plain bought call has a base (its debit): not inert
    expect(runBacktest(tpl("Buy Call"), days(), { ...opts, minDte: 1, to: day(0), exits: { targetPct: 0.5 } }).trades[0]!.ruleInert).toBe(false);
  });
});

describe("HC-TR-203 walk-forward folds", () => {
  it("two folds split the shown entries into halves whose closed trades add up to the whole, name their periods, and the result is unchanged without folds", () => {
    const whole = runBacktest(tpl("Buy Call"), days(), opts);
    const split = runBacktest(tpl("Buy Call"), days(), { ...opts, folds: 2 });
    expect(whole.folds).toBeUndefined();
    expect(split.folds).toHaveLength(2);
    // five entries: the first fold takes two, the second three (the later fold takes the extra)
    expect(split.folds!.map((f) => [f.firstDay, f.lastDay, f.entries])).toEqual([
      [day(0), day(1), 2],
      [day(2), day(4), 3],
    ]);
    expect(split.folds![0]!.stats.trades + split.folds![1]!.stats.trades).toBe(whole.stats.trades);
    expect(split.folds![0]!.stats.total + split.folds![1]!.stats.total).toBeCloseTo(whole.stats.total, 10);
    // the folds leave the headline figures as they were
    expect({ ...split, folds: undefined }).toEqual({ ...whole, folds: undefined });
    // three folds of five: 1, 2, 2
    expect(foldsOf(whole.trades, 3).map((f) => f.entries)).toEqual([1, 2, 2]);
    // a fold without a trade has null days and empty stats
    expect(foldsOf([], 2)).toEqual([
      { index: 0, firstDay: null, lastDay: null, entries: 0, stats: statsOf([], []) },
      { index: 1, firstDay: null, lastDay: null, entries: 0, stats: statsOf([], []) },
    ]);
    expect(statsOf([], []).trades).toBe(0);
  });
});

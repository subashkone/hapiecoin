// The backtest of a saved Autopilot strategy, run in the app (ADR-144; HC-TR-288). For every day of the period it
// asks what the engine would ask at the strategy's entry window: is there an entry (`proposalFor`, the function the
// engine calls), on which expiry and strikes, is there a plan on those prices (`savedPlanFor`), is a trade of it still
// open, was this expiry traded already. An entry is then replayed over the exchange's recorded marks of its legs
// (`simulateTrade`) to its exits or its settlement, with the exchange's fees. The figures are the trades' results
// after fees.
//
// Where it differs from the engine at work, and the run says each of these with its figures:
// - the strike ladder of an entry is the one recorded at the last settlement before it, extended past its ends by
//   the strikes the exchange was pricing at the entry (a strike listed since inside the recorded range is not seen);
// - the legs are priced at the
//   entry instant from their candles (a leg chosen by premium among the options priced then, from the money outwards);
// - an entry is tried on every bar of the window's first hour and then once an hour to its end, where the engine
//   looks after every fresh snapshot: a trade the engine would take minutes after another closed is taken up to an
//   hour later here;
// - the spot, the settlement price included, is the perpetual's mark (the series the recorded chain keeps), and sizes
//   are in the exchange's lot;
// - fills are at the bar's mark, and a bar is one price (see clock-sim.ts).
// A strategy it cannot judge is refused with the reason, never given figures: its figures are typed by hand as before.
// PAPER ARITHMETIC ONLY: public prices are read; nothing is placed anywhere.
import { type EodDay, type EodExpiry, type Playbook, calendarFor, daysToExpiryOf, isMonthEndExpiry, playbookTemplate, proposalFor } from "@hapiecoin/pricing";
import { AUTOPILOT_MAX_OPEN, type SavedBacktestResolution, type SavedBacktestRun, type SavedBacktestTrade, type SavedDefinition, type Underlying, type Venue, settlementMsOf } from "@hapiecoin/schema";
import { defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { CLOCK_ONCE_MS, inWindow, savedPlanFor, savedPlanRefusal, skipText } from "./autopilot.js";
import { savedPlaybook } from "./autopilot-saved.js";
import { eodDays } from "./chain-eod.js";
import { HISTORY_STRIKE_STEP } from "./chain-eod-history.js";
import { type SimBar, type SimLeg, simulateTrade } from "./clock-sim.js";
import type { Db } from "./db/client.js";
import { type MarkSource, RESOLUTION_MS, marksOf } from "./mark-candles.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const VENUE: Venue = "delta_india";
/** Delta names the mark-price series of a product "MARK:<symbol>" in its candle history. */
const MARK_PREFIX = "MARK:";
/** How far back a run looks when no period is given: a daily strategy on 5-minute prices, the others on hourly ones. */
export const BACKTEST_SPAN_DAYS: Record<SavedBacktestResolution, number> = { "5m": 120, "1h": 365 };
/** The longest period a run takes, whatever is asked: a year and a little of hourly prices, half of that of 5-minute ones. */
export const BACKTEST_MAX_DAYS: Record<SavedBacktestResolution, number> = { "5m": 200, "1h": 400 };
/** Every bar of the window's first hour is tried for an entry; after that, one bar an hour. */
const FIRST_HOUR_MS = 3_600_000;
/** The spot a move is judged against may be this many bars from the instant asked for (the engine takes a snapshot within half an hour). */
const MOVE_REACH_BARS = 6;
/** The reasons a day has no trade that are a lack of data, not a decision of the strategy. */
const NO_DATA = ["No spot price at the entry", "No price for a leg at the entry", "No recorded chain before the entry", "No settlement price for its expiry", "The options were not priced far enough from the money for its premium", "No price in its entry window"] as const;
const UNSETTLED = "Its expiry has not settled yet";
/** The legs' strikes are not among the recorded ones nor among those the exchange priced beyond them at the entry: the engine would find no fit either. */
const OFF_LADDER = "Its strikes are not among the ones listed at the entry";
/** The most strikes looked for beyond one end of the recorded ladder when the price has moved past it. */
export const LADDER_REACH = 25;
/** The most strikes priced outwards from the money for a leg chosen by premium. */
const PREMIUM_WALK = 30;

export type SavedBacktestResult = Pick<SavedBacktestRun, "from" | "to" | "resolution" | "figures" | "noEntry" | "barsJudged" | "barsSkipped" | "notes" | "trades">;
/** A strategy or a period the app cannot backtest: said to the admin as it is. */
export class BacktestRefused extends Error {}

/** 5-minute prices for a strategy on the next expiries, hourly ones for anything held longer. */
export const resolutionOf = (d: SavedDefinition): SavedBacktestResolution => (d.cadence === "daily" && d.maxDte <= 3 ? "5m" : "1h");
/** Why the app cannot backtest these settings; null when it can. */
export function backtestRefusal(d: SavedDefinition): string | null {
  if (d.conditions?.ivRank) return "It enters on a volatility rank, which the recorded history cannot judge far enough back. Enter its backtest figures by hand.";
  return null;
}

const dayOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const msOfDay = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const round = (n: number, digits: number): number => Number(n.toFixed(digits));

export interface BacktestDeps {
  db: Db;
  source: MarkSource;
  now: () => number;
  /** Called after each day looked at. */
  onProgress?: ((done: number, total: number) => Promise<void>) | undefined;
}

export async function backtestSaved(deps: BacktestDeps, row: { id: string; name: string; summary: string; definition: SavedDefinition }, range: { from?: string | undefined; to?: string | undefined } = {}): Promise<SavedBacktestResult> {
  const d = row.definition;
  const refused = backtestRefusal(d);
  if (refused) throw new BacktestRefused(refused);
  const p = savedPlaybook({ ...row, backtest: null });
  const clock = p.clock!;
  // the legs whose strike is read off the ladder, and the ones chosen by their price at the entry
  const template = playbookTemplate(p)!;
  const byPremium = template.legs.flatMap((l) => (l.kind !== "future" && l.premium !== undefined ? [{ kind: l.kind, premium: l.premium }] : []));
  const fixedLegs = template.legs.filter((l) => l.kind === "future" || l.premium === undefined);
  // (read without the rule that leaves one side out after a move: every leg is priced, as the template is materialised whole before a side is dropped)
  const fixed: Playbook | null = fixedLegs.length === 0 ? null : { ...p, template: { ...template, legs: fixedLegs }, clock: { ...clock, moveSide: undefined } };
  const adapter = getVenue(VENUE);
  const resolution = resolutionOf(d);
  const step = RESOLUTION_MS[resolution];
  const nowMs = deps.now();
  // the last day whose every expiry of that day has settled
  const lastDay = dayOfMs(nowMs - DAY_MS);
  const to = range.to !== undefined && range.to < lastDay ? range.to : lastDay;
  const histories = new Map<Underlying, EodDay[]>();
  for (const asset of d.assets) histories.set(asset, [...(await eodDays(deps.db, VENUE, asset))].sort((a, b) => a.day.localeCompare(b.day)));
  const recorded = [...histories.values()].flatMap((days) => (days[0] ? [days[0].day] : []));
  if (recorded.length === 0) throw new BacktestRefused("There is no recorded price history for its coins yet.");
  const earliest = recorded.sort()[0]!;
  const wanted = range.from ?? dayOfMs(msOfDay(to) - BACKTEST_SPAN_DAYS[resolution] * DAY_MS);
  const longest = dayOfMs(msOfDay(to) - (BACKTEST_MAX_DAYS[resolution] - 1) * DAY_MS);
  const from = [wanted, earliest, longest].sort().at(-1)!;
  if (from > to) throw new BacktestRefused("The period has no recorded price history.");
  const fromMs = msOfDay(from);
  const toMs = msOfDay(to) + DAY_MS;
  const total = d.assets.length * Math.round((toMs - fromMs) / DAY_MS);
  let done = 0;

  const noEntry: Record<string, number> = {};
  const trades: SavedBacktestTrade[] = [];
  let barsJudged = 0;
  let barsSkipped = 0;
  let entryDays = 0;

  for (const asset of d.assets) {
    const days = histories.get(asset)!;
    const calendar = calendarFor(adapter.calendar.settlementHourUtc(asset));
    const unitsPerLot = Number((defaultLotSizes(adapter) as Record<string, string>)[asset]);
    const key = (symbol: string) => ({ venue: VENUE, symbol: `${MARK_PREFIX}${symbol}`, resolution });
    // the spot: from before the period (a look-back of up to a week) to the last settlement a trade of it can reach
    const spot = await marksOf(deps.db, deps.source, key(adapter.symbols.perpetual(asset)), fromMs - 8 * DAY_MS, Math.min(nowMs, toMs + (d.maxDte + 2) * DAY_MS), nowMs);
    const legMarks = new Map<string, Map<number, number>>();
    const marksFor = async (kind: "call" | "put", strike: number, expiry: string, startMs: number, settleMs: number): Promise<Map<number, number>> => {
      const id = `${kind}|${strike}|${expiry}`;
      let held = legMarks.get(id);
      if (!held) legMarks.set(id, (held = await marksOf(deps.db, deps.source, key(adapter.symbols.formatOption(kind, asset, String(strike), expiry)), startMs, settleMs, nowMs)));
      return held;
    };
    const open: number[] = []; // when each trade still counted as held closes
    let lastEntryMs = -Infinity;
    const tradedExpiries = new Set<string>();

    type Attempt = { ok: true } | { ok: false; reason: string; retry: boolean };
    const no = (reason: string, retry = false): Attempt => ({ ok: false, reason, retry });
    const entryAt = async (t: number): Promise<Attempt> => {
      const s = spot.get(t);
      if (s === undefined) return no("No spot price at the entry", true);
      if (t - lastEntryMs < CLOCK_ONCE_MS) return no("Already entered in this window", true);
      if (open.filter((closes) => closes > t).length >= AUTOPILOT_MAX_OPEN) return no("Holds a trade already: one at a time for a strategy and coin", true);
      const today = dayOfMs(t);
      const prior = days.filter((x) => x.day < today);
      const base = [...days].reverse().find((x) => x.ts <= t);
      if (!base) return no("No recorded chain before the entry");
      const ladder = base.expiries.filter((e) => (settlementMsOf(e.expiry, asset) ?? 0) > t);
      // the spot a move is judged against: the bar asked for, or the nearest within half an hour of 5-minute bars
      let before: number | undefined;
      if (d.moveSide) for (let k = 0; k <= MOVE_REACH_BARS && before === undefined; k++) before = spot.get(t - d.moveSide.hours * HOUR_MS - k * step) ?? spot.get(t - d.moveSide.hours * HOUR_MS + k * step);
      const propose = (playbook: Playbook, expiries: EodExpiry[]) => proposalFor(playbook, [...prior, { day: today, ts: t, spot: s, expiries }], { unitsPerLot, calendar, spotBefore: before ?? null });
      // the conditions (an average, the weekdays, a move to judge) on the recording's own prices: no download on a day they are not met
      const check = propose(p, ladder);
      if (!check.ok && check.reason !== "noFit") return no(skipText(check.reason));
      // the expiry by the rule `entryFor` applies: the first listed one far enough out (a monthly strategy: a month-end one)
      const chain = [...ladder].sort((x, y) => x.expiry.localeCompare(y.expiry)).find((e) => daysToExpiryOf(calendar, t, e.expiry) >= p.minDte && (clock.cadence !== "monthly" || isMonthEndExpiry(e.expiry)));
      if (!chain || daysToExpiryOf(calendar, t, chain.expiry) > d.maxDte) return no("No expiry in its range on that day", true);
      const expiry = chain.expiry;
      if (d.oncePerExpiry && tradedExpiries.has(expiry)) return no("Already traded this expiry", true);
      const settleMs = settlementMsOf(expiry, asset)!;
      if (settleMs > nowMs) return no(UNSETTLED);
      // The strikes the entry can choose from: the recorded ones, and, where the price has since moved towards or past
      // an end of that recording, the strikes beyond it that the exchange was pricing at the entry instant (it lists
      // new ones as the price moves). A strike is never assumed: a candidate on the grid the nightly chain history
      // walks (ADR-098) counts only when one of the options asked about has a mark at the entry.
      const rows = [...chain.rows].sort((x, y) => x.strike - y.strike).map((r) => ({ strike: r.strike }));
      const grid = HISTORY_STRIKE_STEP[asset];
      /** Candidates beyond one end, nearest first, while `more` says the ladder is still short; at most LADDER_REACH. Returns the mark of each priced one. */
      const extend = async (up: boolean, kinds: readonly ("call" | "put")[], more: (candidate: number) => boolean, each?: (mark: number) => boolean): Promise<void> => {
        if (grid === undefined || rows.length === 0) return;
        const end = up ? Math.max(...rows.map((r) => r.strike)) : Math.min(...rows.map((r) => r.strike));
        for (let n = 1; n <= LADDER_REACH && more(up ? end + (n - 1) * grid : end - (n - 1) * grid); n++) {
          const strike = up ? end + n * grid : end - n * grid;
          let mark: number | undefined;
          for (const kind of kinds) mark = (await marksFor(kind, strike, expiry, t - step, settleMs)).get(t) ?? mark;
          if (mark === undefined) continue;
          rows.push({ strike });
          if (each && !each(mark)) break;
        }
        rows.sort((x, y) => x.strike - y.strike);
      };
      // the strikes of the legs chosen by strikes or per cent do not depend on prices: read them off the ladder, which
      // has to hold, each side of the price, as many strikes as the furthest such leg counts (and two more) and to
      // pass the furthest per cent (by two steps): an expiry on a wider step than the grid is reached by the count
      if (fixed) {
        const fixedKinds = [...new Set(fixedLegs.flatMap((l) => (l.kind === "future" ? [] : [l.kind])))];
        const count = Math.max(0, ...d.legs.map((l) => (l.by === "strikes" ? l.value + 2 : 0)));
        const far = Math.max(0, ...d.legs.map((l) => (l.by === "pct" ? (s * l.value) / 100 + 2 * (grid ?? 0) : 0)));
        await extend(true, fixedKinds, (c) => rows.filter((r) => r.strike > s).length < count || c < s + far);
        await extend(false, fixedKinds, (c) => rows.filter((r) => r.strike < s).length < count || c > s - far);
        const placed = propose(fixed, [{ expiry, rows: rows.map((r) => ({ strike: r.strike, call: { mark: 1 }, put: { mark: 1 } })) }]);
        // (tried again on the next bar where strikes can be looked for: one newly listed may have its first bar a little later)
        if (!placed.ok) return no(placed.reason === "noFit" ? OFF_LADDER : skipText(placed.reason), grid !== undefined);
        for (const leg of placed.proposal.legs) await marksFor(leg.kind as "call" | "put", Number(leg.strike), expiry, t - step, settleMs);
      }
      // a leg chosen by premium: the options out of the money are priced at the entry instant, from the money outwards,
      // until one is worth less than half the premium asked for (the template takes the nearest, and none beyond half);
      // where the recorded strikes end before that, the walk goes on over the ones the exchange priced beyond them
      for (const leg of byPremium) {
        const out = rows.map((r) => r.strike).filter((k) => (leg.kind === "call" ? k > s : k < s)).sort((x, y) => (leg.kind === "call" ? x - y : y - x));
        let last: number | undefined;
        let nearest = Infinity;
        const seen = (mark: number): boolean => {
          last = mark;
          nearest = Math.min(nearest, Math.abs(mark - leg.premium));
          return mark >= leg.premium / 2;
        };
        let walking = true;
        for (const strike of out.slice(0, PREMIUM_WALK)) {
          const mark = (await marksFor(leg.kind, strike, expiry, t - step, settleMs)).get(t);
          if (mark !== undefined && !seen(mark)) {
            walking = false;
            break;
          }
        }
        if (walking && out.length < PREMIUM_WALK) await extend(leg.kind === "call", [leg.kind], () => true, seen);
        // nothing priced about there, and the furthest option priced is still dearer: the strikes end before its
        // premium is reached, and a strike nearer the money than the engine would sell is no answer
        if (nearest > leg.premium / 2 && last !== undefined && last > leg.premium) return no("The options were not priced far enough from the money for its premium");
      }
      // then on the prices of the entry instant itself
      const quote = (kind: "call" | "put", strike: number) => {
        const mark = legMarks.get(`${kind}|${strike}|${expiry}`)?.get(t);
        return mark === undefined ? {} : { [kind]: { mark } };
      };
      const second = propose(p, [{ expiry, rows: rows.map((r) => ({ strike: r.strike, ...quote("call", r.strike), ...quote("put", r.strike) })) }]);
      if (!second.ok) return no(second.reason === "noFit" ? "No price for a leg at the entry" : skipText(second.reason), true);
      const proposal = second.proposal;
      // (every leg has a price above zero here: a close that is not one is never kept, see mark-candles.ts)
      const plan = savedPlanFor(p, proposal, unitsPerLot, adapter.feeRule);
      if (!plan) return no(savedPlanRefusal(p, proposal, unitsPerLot, adapter.feeRule) ?? "The premium collected is smaller than the fees", true);
      const settleSpot = spot.get(settleMs) ?? days.find((x) => x.day === expiry)?.spot;
      if (settleSpot === undefined) return no("No settlement price for its expiry");
      const legs: SimLeg[] = proposal.legs.map((l) => ({ kind: l.kind as "call" | "put", side: l.side, strike: Number(l.strike), lots: l.lots, price: Number(l.price) }));
      const series = legs.map((l) => legMarks.get(`${l.kind}|${l.strike}|${expiry}`)!);
      const bars: SimBar[] = [];
      for (let b = t + step; b < settleMs; b += step) bars.push({ ts: b, marks: series.map((m) => m.get(b) ?? null), spot: spot.get(b) ?? null });
      const sim = simulateTrade({ legs, plan, unitsPerLot, feeRule: adapter.feeRule, entryMs: t, entrySpot: s, settleMs, settleSpot, bars });
      lastEntryMs = t;
      open.push(sim.closedMs);
      tradedExpiries.add(expiry);
      barsJudged += sim.barsJudged;
      barsSkipped += sim.barsSkipped;
      trades.push({ asset, entryAt: new Date(t).toISOString(), closedAt: new Date(sim.closedMs).toISOString(), expiry, spot: s, legs, gross: round(sim.gross, 2), fees: round(sim.fees, 4), net: round(sim.net, 2), reason: sim.reason, events: sim.events.map((e) => ({ at: new Date(e.ts).toISOString(), kind: e.kind, pnl: round(e.pnl, 2) })), barsSkipped: sim.barsSkipped });
      return { ok: true };
    };

    for (let dayMs = fromMs; dayMs < toMs; dayMs += DAY_MS) {
      const opens = dayMs + d.fromHourUtc * HOUR_MS;
      // (a weekly strategy's window is open on one day of the week)
      if (inWindow(clock, opens)) {
        entryDays += 1;
        let entered = false;
        // the day is counted under what stopped it when its window opened, whatever stopped it later in the day
        let reason: string | null = null;
        // every bar of the first hour, then one an hour to the end of the window: a trade that ends inside a long
        // window frees the next entry as it does for the engine, to the hour
        for (let t = opens; t + step <= nowMs && inWindow(clock, t) && dayOfMs(t) === dayOfMs(opens); t = t - opens + step < FIRST_HOUR_MS ? t + step : opens + (Math.floor((t - opens) / HOUR_MS) + 1) * HOUR_MS) {
          const attempt = await entryAt(t);
          if (attempt.ok) entered = true;
          else reason ??= attempt.reason;
          if (!attempt.ok && !attempt.retry) break;
        }
        if (!entered) noEntry[reason ?? "No price in its entry window"] = (noEntry[reason ?? "No price in its entry window"] ?? 0) + 1;
      }
      done += 1;
      await deps.onProgress?.(done, total);
    }
  }

  trades.sort((a, b) => a.entryAt.localeCompare(b.entryAt));
  const nets = trades.map((x) => x.net);
  const fine = resolution === "5m";
  const figures =
    nets.length === 0
      ? null
      : {
          mean: round(nets.reduce((a, b) => a + b, 0) / nets.length, 2),
          // "a day" and "a week" are one trade of one coin in each; anything else is said per trade
          per: d.assets.length > 1 ? ("trade" as const) : d.cadence === "weekly" ? ("week" as const) : d.cadence === "daily" && fine && !d.oncePerExpiry ? ("day" as const) : ("trade" as const),
          positivePct: round((100 * nets.filter((n) => n > 0).length) / nets.length, 1),
          worst: Math.min(...nets),
          samples: nets.length,
          basis: `HapieCoin backtest, ${from} to ${to}: ${fine ? "5-minute" : "hourly"} mark prices from Delta Exchange India, the exchange's fees counted, fills at the bar's price with no slippage.`,
        };
  const noData = NO_DATA.reduce((n, reason) => n + (noEntry[reason] ?? 0), 0);
  const unsettled = noEntry[UNSETTLED] ?? 0;
  const notes = [
    "Fills are at the price of the bar: no bid and ask, no slippage.",
    `Prices are ${fine ? "5 minutes" : "an hour"} apart: a level touched and left inside a bar is not seen, and an exit is booked at the bar's price, not at its level.`,
    "The strikes on offer at an entry are the ones recorded at the last settlement before it, with the ones beyond its ends that the exchange was pricing at the entry.",
    `An entry is tried on each bar of the window's first hour and then once an hour; Autopilot itself looks every few minutes.`,
    "The spot, the settlement price included, is the mark price of the perpetual; sizes are in the exchange's lot.",
    ...(noData > 0 ? [`${noData} of ${entryDays} entry days had no usable price and are not in the figures.`] : []),
    ...(unsettled > 0 ? [`${unsettled} entry ${unsettled === 1 ? "day" : "days"} whose expiry had not settled yet ${unsettled === 1 ? "is" : "are"} left out.`] : []),
    ...(barsSkipped > 0 ? [`${barsSkipped} of ${barsJudged + barsSkipped} bars had no price for an open leg and were not judged.`] : []),
    ...(d.assets.length > 1 ? [`The trades of ${d.assets.join(", ")} are counted together.`] : []),
    ...(wanted < from ? [from === earliest ? `The recorded history starts on ${from}: the period asked for began earlier.` : `The period was shortened to its last ${BACKTEST_MAX_DAYS[resolution]} days, the most one run takes on these prices.`] : []),
  ];
  return { from, to, resolution, figures, noEntry, barsJudged, barsSkipped, notes, trades };
}

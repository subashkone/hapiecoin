/**
 * Playbooks (ADR-101; HC-TR-205): a structure from the catalogue plus the plan around it, as data. Each playbook names
 * its template (or carries one inline), the entry conditions, the exit rules, the minimum days to expiry, a fixed size,
 * the assets it applies to, a plain-language rationale with the evidence it rests on, the number of parameter
 * configurations that were looked at before these were fixed, and the thresholds its record must clear. The seven
 * below come from docs/research/proven-strategies-crypto.md and docs/research/strategy-playbooks.md; one of them,
 * hero-or-zero, is the control: it ships to fail, and a record that passes says the engine or the data is suspect.
 * Nothing here is a recommendation; every card carries its record and the warning that a backtest is not a forecast.
 */
import { type BacktestConditions, type BacktestExits, type BacktestFold, type BacktestOptions, type BacktestStats, type BacktestTrade, type EntrySkip, type EodDay, entryFor } from "./backtest.js";
import { expiryExtremes } from "./strategy.js";
import { type MaterialisedLeg, type StrategyTemplate, templateByName } from "./templates.js";

export type PlaybookAsset = "BTC" | "ETH" | "XAUT";
export type PlaybookStatus = "pass" | "fail" | "insufficient" | "control-ok" | "control-alarm";

export interface PlaybookThresholds {
  /** Closed trades needed before the record is judged at all. */
  minTrades: number;
  /** The net total over the whole record must be positive. */
  netPositive: boolean;
  /** The out-of-sample half (the second fold of two) must be positive too. */
  outOfSamplePositive: boolean;
}

export interface Playbook {
  id: string;
  name: string;
  /** One sentence a first-time trader understands. */
  summary: string;
  /** Why this plan and not another, in plain words. */
  rationale: string;
  /** The evidence the plan rests on, with where it comes from. */
  evidence: { claim: string; source: string };
  /** A catalogue template name, or an inline template when the catalogue has no such shape. */
  template: string | StrategyTemplate;
  conditions?: BacktestConditions | undefined;
  exits?: BacktestExits | undefined;
  /** The entry takes the nearest listed expiry with at least this many days left. */
  minDte: number;
  /** Fixed size for the record; volatility-based sizing is not built yet (GAPS #135). */
  lots: number;
  assets: readonly PlaybookAsset[];
  thresholds: PlaybookThresholds;
  /** How many parameter configurations were examined before these were fixed, and where. */
  trials: { count: number; note: string };
  /** The control ships to fail: a passing record is the alarm. */
  control: boolean;
  /**
   * ADR-112: a plan entered by the clock, once a day, on the nearest expiry, with its own exits. Autopilot alone
   * trades these (they are not in PLAYBOOKS, so the daily record and the proposals do not see them).
   */
  clock?: PlaybookClock | undefined;
}

export interface PlaybookClock {
  /** The entry window in UTC hours: from the first, before the second. */
  fromHourUtc: number;
  toHourUtc: number;
  /** The window as the trader reads it. */
  window: string;
  /** The entry's expiry is at most this many days out: the next settlement, never a later one when that one has no prices. */
  maxDte: number;
  /** The venues the plan is for: the study behind it covers no other. */
  venues: readonly string[];
  /** Every sold option is closed on its own at this multiple of the price it was sold at; absent: held to settlement. */
  legStop?: number | undefined;
  /** ADR-113: the whole trade is closed once its profit reaches this share of the premium collected; absent: no profit take. */
  takeProfitOfCredit?: number | undefined;
}

const DEFINED_RISK_EXITS: BacktestExits = { targetPct: 0.5, stopPct: 0.5, timeStopDte: 2 };
const TREND_TRIALS = { count: 30, note: "30 moving-average lengths (10 to 300 days) swept on Delta's BTC history, 2020 to 2026; the 40 to 150 day band held, 50 chosen inside it" };
const PASS_RULES: PlaybookThresholds = { minTrades: 20, netPositive: true, outOfSamplePositive: true };

/** Hero-or-zero as the engine sees it: a call four listed strikes out of the money, bought with one day to settlement and held. */
export const HERO_OR_ZERO_TEMPLATE: StrategyTemplate = {
  name: "Hero or zero call",
  category: "Bullish",
  description: "Buy a far out-of-the-money call the day before settlement and hold it. The structure traders call hero or zero.",
  legs: [{ kind: "call", side: "buy", k: 4 }],
  risk: "defined",
};

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "trend-calls",
    name: "Trend with calls",
    summary: "When the spot trades above its 50-day average, buy a call spread two weeks or more out; take half the maximum profit, cut at half the maximum loss, leave two days before settlement.",
    rationale: "Time-series trend following is the one strategy family proven across markets for a century and confirmed on Delta's own history; a call spread expresses it with a defined loss and without paying perpetual funding.",
    evidence: { claim: "Long or flat on the 50-day average, 2020 to 2026, after fees, slippage and actual funding: Sharpe 1.12 against 0.73 for buy-and-hold, worst fall 59 % against 77 %; every length from 30 to 170 days beat holding.", source: "docs/research/proven-strategies-crypto.md, our own run on Delta data; Hurst, Ooi and Pedersen for the century of evidence" },
    template: "Bull Call Spread",
    conditions: { sma: { days: 50, side: "above" } },
    exits: DEFINED_RISK_EXITS,
    minDte: 14,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: TREND_TRIALS,
    control: false,
  },
  {
    id: "trend-puts",
    name: "Trend with puts",
    summary: "When the spot trades below its 50-day average, buy a put spread two weeks or more out, with the same exits.",
    rationale: "The mirror of the call playbook. The research found long/flat beat long/short on the perpetual because shorts paid in whipsaws; a put spread caps that cost at the debit.",
    evidence: { claim: "The same 50-day rule; the short side on the perpetual never beat long/flat, which is why the downtrend is expressed with a defined-risk spread rather than a short.", source: "docs/research/proven-strategies-crypto.md, Part A of our verification" },
    template: "Bear Put Spread",
    conditions: { sma: { days: 50, side: "below" } },
    exits: DEFINED_RISK_EXITS,
    minDte: 14,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: TREND_TRIALS,
    control: false,
  },
  {
    id: "premium-harvest",
    name: "Premium harvest",
    summary: "When implied volatility ranks in the upper half of its year, sell an iron condor a month or more out; take half the credit, cut at half the maximum loss, leave with three weeks to go.",
    rationale: "Options have priced more volatility than happened in equities for decades and in bitcoin since 2017, but the bitcoin premium shrank from 13 to 3 vol points after 2024, so this plays only when the rank says the premium is there, and only with defined risk.",
    evidence: { claim: "Bitcoin's implied minus realised volatility was positive on about three days in four, 2021 to 2026, and compressed from 13.2 to 3.4 points; no public crypto condor backtest with fees exists, so this record is the first.", source: "docs/research/proven-strategies-crypto.md, premium-selling section; Cboe PUT index history for the equity precedent" },
    template: "Iron Condor",
    conditions: { ivRank: { min: 50, lookbackDays: 365 } },
    exits: { targetPct: 0.5, stopPct: 0.5, timeStopDte: 21 },
    minDte: 30,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: { count: 3, note: "three entry filters tried in the literature (none, IV rank above 30, above 50); the 45-day, 50 %-target folklore is contested in equities and untested in crypto" },
    control: false,
  },
  {
    id: "expiry-week-credit",
    name: "Expiry-week credit spread",
    summary: "In an uptrend, sell a put spread three or more days from settlement; take half the credit, cut at half the maximum loss.",
    rationale: "Short-dated selling has a thin, real edge in equities (condors win 63 to 72 % of the time) that one bad week erases; the trend filter keeps the sold side away from the move, and the defined wing caps the bad week.",
    evidence: { claim: "Option Alpha's 25,000 expiry-day trades: iron condors 63 % winners, afternoon entries far better than morning. Our own 90-day Delta sample tested a naked strangle, an iron condor, butterflies, ladders and ratio spreads on daily expiries: every one lost after fees outside the 14:30 to 16:30 IST window; a put spread with a trend filter was not among them, which is what this record tests.", source: "docs/research/proven-strategies-crypto.md, expiry-day section; docs/research/backtest-daily-structures.md" },
    template: "Bull Put Spread",
    conditions: { sma: { days: 50, side: "above" } },
    exits: { targetPct: 0.5, stopPct: 0.5 },
    minDte: 3,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: { count: 2, note: "two entry horizons tried (one day and three days to settlement); the research tested the structures, not the filter" },
    control: false,
  },
  {
    id: "pin-butterfly",
    name: "Pin butterfly",
    summary: "The day before settlement, buy a call butterfly centred at the money; take three quarters of the maximum profit or hold to settlement.",
    rationale: "A cheap bet that the price settles near where it is; the loss is the small debit and the payoff pays only on a pin, so the hit rate will be low and the record must show the average win covers the misses.",
    evidence: { claim: "Expiry-day pinning is documented for single stocks (Ni, Pearson and Poteshman); nothing published tests it on crypto dailies. Our own 90-day Delta sample is negative: the butterfly centred at the money won on 29 to 34 % of days and lost on average after fees. It ships as a plan to test, not as proven, and its record is expected to fail unless a better centre is found.", source: "docs/research/proven-strategies-crypto.md; docs/research/backtest-daily-structures.md; docs/research/strategy-playbooks.md §3" },
    template: "Long Call Butterfly",
    exits: { targetPct: 0.75 },
    minDte: 1,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: { count: 1, note: "one configuration, centred at the money; centring on max pain needs a condition the engine does not have yet (GAPS #135)" },
    control: false,
  },
  {
    id: "covered-call",
    name: "Covered call",
    summary: "Hold the perpetual and sell a call a month or more out; take half the credit or leave a week before settlement.",
    rationale: "A covered call gives up the top of a rally for a steady credit; the only crypto backtest found beat holding over 2024 to 2026 because of the drawdowns, not the rallies. Funding on the perpetual is NOT charged in this record (the engine has no funding term, GAPS #135), and the research puts funding at 9 to 12 points of return a year, so a passing record here would still overstate the real result.",
    evidence: { claim: "Monthly 50-delta covered calls on BTC, June 2024 to May 2026, mid fills, no fees: +27.6 % against +12.2 % for holding, worst fall 26 % against 47 %; the covered-call ETFs lagged spot in the 2024 to 2025 rally.", source: "docs/research/proven-strategies-crypto.md, premium-selling section" },
    template: "Covered Call",
    exits: { targetPct: 0.5, timeStopDte: 7 },
    minDte: 30,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: { count: 2, note: "weekly and monthly tenors tried in the source; monthly chosen because the weekly lagged holding" },
    control: false,
  },
  {
    id: "hero-or-zero",
    name: "Hero or zero (control)",
    summary: "Buy a call four strikes out of the money the day before settlement and hold it. This card exists to lose.",
    rationale: "Every dataset says far out-of-the-money option buying on expiry day has negative expectancy: 88 to 93 % of Indian retail lose, US retail lost 70 to 125 million dollars on 0DTE, and on 1,426 Delta positions the buyer lost 46 % of the premium once one rally day is removed. A record that passes here means the engine or the data is wrong.",
    evidence: { claim: "Hit rate 2.8 %, total loss 46 % of premium excluding 21 September 2026, over 90 Delta daily expiries, buying 1 to 3 % out-of-the-money options on expiry day itself. The record's version enters a day earlier, at the settlement-hour chain, four listed strikes out; same bet, slightly longer tenor.", source: "docs/research/proven-strategies-crypto.md, Part B of our verification; SEBI F&O studies FY22 to FY26" },
    template: HERO_OR_ZERO_TEMPLATE,
    minDte: 1,
    lots: 10,
    assets: ["BTC", "ETH"],
    thresholds: PASS_RULES,
    trials: { count: 1, note: "one configuration; the control is not tuned" },
    control: true,
  },
];

export function playbookById(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

// ---- ADR-112: the evening strangles, entered by the clock -----------------------------------------------------------

const P_BUY = { kind: "put", side: "buy" } as const;
const P_SELL = { kind: "put", side: "sell" } as const;
const C_BUY = { kind: "call", side: "buy" } as const;
const C_SELL = { kind: "call", side: "sell" } as const;
/** Sell the call and the put `k` listed strikes out; with `wing`, buy the options that many strikes out to cap the loss. */
function strangle(name: string, k: number, wing: number | null): StrategyTemplate {
  const sold = [{ ...P_SELL, k: -k }, { ...C_SELL, k }];
  return {
    name,
    category: "Neutral",
    description: wing === null ? `Sell a call and a put ${k} strikes out of the money on the next expiry.` : `Sell a call and a put ${k} strikes out of the money on the next expiry and buy the options ${wing} strikes out to cap the loss.`,
    legs: wing === null ? sold : [{ ...P_BUY, k: -wing }, ...sold, { ...C_BUY, k: wing }],
    risk: wing === null ? "undefined" : "defined",
  };
}
/**
 * 16:00 to 17:00 UTC. Autopilot enters on its first pass inside the window, so the entry is the study's 16:00 UTC bar
 * ("21:30 IST"), the one every figure quoted on these cards is for, about two hours after the US cash open.
 */
const EVENING = { fromHourUtc: 16, toHourUtc: 17, window: "9:30 to 10:30 PM IST", maxDte: 1.5, venues: ["delta_india"] } as const;
const STUDY = "docs/research/scripts/autopilot-study (106 BTC daily expiries, 8 Aug to 21 Nov 2026, 5-minute marks, the exchange's real fees, 100 lots)";
const STUDY_TRIALS = { count: 456, note: "19 structures at 24 entry hours on the same 106 days, with several exits each; these were chosen after seeing the results, so their figures are in-sample and the paper record is the test" };
/** Never judged by the daily record (it enters at the settlement hour, the worst hour of the study): Autopilot's own results are the record. */
const NO_RECORD: PlaybookThresholds = { minTrades: Number.MAX_SAFE_INTEGER, netPositive: true, outOfSamplePositive: true };
const clockPlaybook = (id: string, name: string, summary: string, rationale: string, claim: string, template: StrategyTemplate, legStop?: number, takeProfitOfCredit?: number): Playbook => ({
  id,
  name,
  summary,
  rationale,
  evidence: { claim, source: STUDY },
  template,
  // the first settlement at least half a day away: in the evening that is tomorrow's 17:30 IST, about twenty hours out
  minDte: 0.5,
  lots: 100,
  assets: ["BTC"],
  thresholds: NO_RECORD,
  trials: STUDY_TRIALS,
  control: false,
  clock: { ...EVENING, legStop, takeProfitOfCredit },
});

/** The playbooks Autopilot enters by the clock (ADR-112). BTC only: the study behind them covers no other asset. */
export const CLOCK_PLAYBOOKS: readonly Playbook[] = [
  clockPlaybook(
    "evening-strangle-wings-3",
    "Evening strangle with wings",
    "Each evening sell a call and a put three strikes out on the next expiry and buy the options eight strikes out; hold to settlement.",
    "Selling the evening's time value was the only daily structure that earned after fees in the study, and the bought wings cap the loss, so it needs no stop and little margin. It was the one version positive in each of the four months.",
    "Sold 600 away with wings 1,600 away, entered 21:30 IST, held to settlement: +5.93 a day on 84 days, 73 % of days positive, worst day -78; August +128, September +130, October +74, November +167.",
    strangle("Evening strangle with wings (3 / 8)", 3, 8),
  ),
  clockPlaybook(
    "evening-strangle-wings-5",
    "Wide evening strangle with wings",
    "Each evening sell a call and a put five strikes out on the next expiry and buy the options ten strikes out; hold to settlement.",
    "The same trade further from the price: it wins more often and earns less each time. The far wings had a price on about half the days only, so this is the thinnest record of the four.",
    "Sold 1,000 away with wings 2,000 away, entered 21:30 IST, held to settlement: +7.68 a day on 55 days, 89 % of days positive, worst day -90; every month positive, October by 9 only.",
    strangle("Evening strangle with wings (5 / 10)", 5, 10),
  ),
  clockPlaybook(
    "evening-strangle-stop-2x",
    "Evening strangle, stop at double",
    "Each evening sell a call and a put three strikes out on the next expiry; buy either one back if its price doubles, and hold the other to settlement.",
    "The usual way a sold strangle is run. The stop on each option turns the rare very large loss into a moderate one for about the same average; it has no bought wing, so on a venue it needs full margin.",
    "Sold 600 away, entered 21:30 IST, each option stopped at twice its price: +7.51 a day on 106 days, 45 % of days positive, worst day -60; without the stop the worst day was -349 and October lost 323. August lost 53 with the stop.",
    strangle("Evening strangle (3)", 3, null),
    2,
  ),
  clockPlaybook(
    "evening-strangle-stop-3x",
    "Evening strangle, stop at triple",
    "Each evening sell a call and a put three strikes out on the next expiry; buy either one back if its price triples, and hold the other to settlement.",
    "The same trade with more room: the stop at double was hit by ordinary swings on more than half the days, the stop at triple less often.",
    "Sold 600 away, entered 21:30 IST, each option stopped at three times its price: +12.00 a day on 106 days, 61 % of days positive, worst day -98.",
    strangle("Evening strangle (3)", 3, null),
    3,
  ),
  clockPlaybook(
    "evening-strangle-take-half",
    "Evening strangle, take half",
    "Each evening sell a call and a put three strikes out on the next expiry; close the whole trade once it is up by half the premium, and buy either option back if its price doubles.",
    "The owner's quick-profit version, beside the stop-at-double one it is otherwise identical to: the same entry and the same stops, so the two differ only in taking the profit early. In the study it earned a little less on average and was the only naked version positive in each of the four months.",
    "Sold 600 away, entered 21:30 IST, each option stopped at twice its price, the whole trade closed at half the premium: +6.75 a day on 106 days, 59 % of days positive, worst day -60; August +175, September +242, October +5, November +293.",
    strangle("Evening strangle (3)", 3, null),
    2,
    0.5,
  ),
];

/** Every playbook Autopilot may trade: the recorded ones (never the control) and the ones entered by the clock. */
export const AUTOPILOT_PLAYBOOKS: readonly Playbook[] = [...PLAYBOOKS.filter((p) => !p.control), ...CLOCK_PLAYBOOKS];
export function autopilotPlaybookById(id: string): Playbook | undefined {
  return AUTOPILOT_PLAYBOOKS.find((p) => p.id === id);
}

/** The template a playbook places: from the catalogue by name, or its inline one. */
export function playbookTemplate(p: Playbook): StrategyTemplate | undefined {
  return typeof p.template === "string" ? templateByName(p.template) : p.template;
}

/** The engine options for a playbook's record: its plan over `base` (lots, units, calendar, fees, range), with two folds for the in-sample / out-of-sample split. */
export function playbookOptions(p: Playbook, base: Omit<BacktestOptions, "minDte" | "conditions" | "exits" | "folds" | "lots">): BacktestOptions {
  return { ...base, lots: p.lots, minDte: p.minDte, conditions: p.conditions, exits: p.exits, folds: 2 };
}

/** What a playbook would place today (ADR-102): the structure on the latest recorded day, its net premium and expiry extremes. */
export interface PlaybookProposal {
  /** The recorded day the plan would enter on (YYYY-MM-DD). */
  day: string;
  spot: number;
  expiry: string;
  legs: MaterialisedLeg[];
  /** Net premium paid (positive) or received (negative), in underlying-quote money for the plan's size. */
  entryCost: number;
  /** Expiry extremes for the plan's size; Infinity when unbounded. */
  maxProfit: number;
  maxLoss: number;
}
export type ProposalSkip = EntrySkip | "control" | "noDays";
export type ProposalResult = { ok: true; proposal: PlaybookProposal } | { ok: false; reason: ProposalSkip };

/**
 * Whether the playbook's plan enters on the latest recorded day and, when it does, the concrete structure: exactly the
 * entry the record would have taken, through the same `entryFor` the backtest uses. The control never proposes.
 */
export function proposalFor(p: Playbook, daysIn: readonly EodDay[], base: { unitsPerLot: number; calendar: BacktestOptions["calendar"] }): ProposalResult {
  if (p.control) return { ok: false, reason: "control" };
  const tpl = playbookTemplate(p);
  if (!tpl || daysIn.length === 0) return { ok: false, reason: "noDays" };
  const days = [...daysIn].sort((a, b) => a.day.localeCompare(b.day));
  const i = days.length - 1;
  const entry = entryFor(days, i, tpl, { lots: p.lots, unitsPerLot: base.unitsPerLot, minDte: p.minDte, calendar: base.calendar, conditions: p.conditions });
  if (!entry.ok) return { ok: false, reason: entry.reason };
  const d = days[i]!;
  const entryCost = entry.legs.reduce((sum, l) => sum + (l.kind === "future" ? 0 : (l.side === "buy" ? 1 : -1) * l.quantity * l.price), 0);
  const { maxProfit, maxLoss } = expiryExtremes(entry.legs);
  return { ok: true, proposal: { day: d.day, spot: d.spot, expiry: entry.expiry, legs: entry.placed, entryCost, maxProfit, maxLoss } };
}

/** Calendar years (by exit day) whose closed trades sum below zero, with the total. */
export function losingYearsOf(trades: readonly BacktestTrade[]): { year: number; total: number }[] {
  const byYear = new Map<number, number>();
  for (const t of trades) {
    if (t.status !== "closed") continue;
    const year = Number(t.exitDay.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + t.pnl);
  }
  return [...byYear.entries()]
    .filter(([, total]) => total < 0)
    .sort((a, b) => a[0] - b[0])
    .map(([year, total]) => ({ year, total }));
}

/**
 * Whether a record clears a playbook's thresholds. Below `minTrades` closed trades it is "insufficient". A control
 * inverts the reading: failing is what it is for ("control-ok"), passing is the alarm.
 */
export function playbookStatus(p: Playbook, stats: BacktestStats, folds: readonly BacktestFold[] | undefined): PlaybookStatus {
  if (stats.trades < p.thresholds.minTrades) return "insufficient";
  const outOfSample = folds?.[folds.length - 1];
  const net = p.thresholds.netPositive ? stats.total > 0 : true;
  const oos = p.thresholds.outOfSamplePositive ? (outOfSample !== undefined && outOfSample.stats.trades > 0 ? outOfSample.stats.total > 0 : false) : true;
  const passes = net && oos;
  if (p.control) return passes ? "control-alarm" : "control-ok";
  return passes ? "pass" : "fail";
}

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
  /** ADR-115: the one day of the week (UTC, 0 = Sunday) the window opens on; absent: every day. */
  weekdayUtc?: number | undefined;
  /** ADR-116: set on a playbook for the monthly expiry; otherwise the cadence follows from `weekdayUtc`. */
  cadence?: "monthly" | undefined;
  /** ADR-117: one entry per expiry: the window is open on many evenings while the expiry is in range, and a trade that ended early is not taken again. */
  oncePerExpiry?: boolean | undefined;
  /** The window as the trader reads it. */
  window: string;
  /** How the entry reads on the card, after "Entered ": when, and on which expiry. */
  describe: string;
  /** The entry's expiry is at most this many days out: the next settlement, never a later one when that one has no prices. */
  maxDte: number;
  /** The venues the plan is for: the study behind it covers no other. */
  venues: readonly string[];
  /** Every sold option is closed on its own at this multiple of the price it was sold at; absent: held to settlement. */
  legStop?: number | undefined;
  /** ADR-113: the whole trade is closed once its profit reaches this share of the premium collected; absent: no profit take. */
  takeProfitOfCredit?: number | undefined;
  /**
   * ADR-114: once a sold option has been stopped, the profit of what is left is trailed and closed when it gives back
   * this percentage of its best (the leg stop's "this leg, then trail the rest", ADR-104); absent: the rest is kept.
   */
  trailRestPct?: number | undefined;
  /**
   * ADR-120: take profit in steps. The levels, in per cent of the premium of the lots still open; at each one an equal
   * part of every leg is closed and the last part is held to a stop or to settlement. One to four levels, rising.
   */
  ladder?: readonly number[] | undefined;
  /**
   * ADR-121: a profit lock. Once the trade's profit reaches `at` of the premium collected, a floor is set at `floor` of
   * it and the whole trade is closed if the profit falls back there; the floor does not move. Shares between 0 and 1.
   */
  lock?: { at: number; floor: number } | undefined;
  /**
   * ADR-121: with `takeProfitOfCredit`, do not close at that level: from there the trade is trailed and closed when its
   * profit gives back this percentage of its best (a trailing target, ADR-103).
   */
  takeTrailPct?: number | undefined;
  /** ADR-121: the whole trade is closed at the first time the clock reads this hour (UTC) after the entry, whatever the profit. */
  exitHourUtc?: number | undefined;
  /**
   * ADR-123: every sold option is bought back on its own once its mark has fallen to this price (in the coin's quote
   * money, per unit as the venue quotes it); the other legs stay. Absent: a cheap option is held to settlement.
   */
  legBuyBackAt?: number | undefined;
  /**
   * ADR-122: one side after a move. The spot is compared with the spot `hours` earlier: up by more than `pct` per cent
   * only the put is sold, down by more than that only the call, otherwise the whole structure. No earlier spot: no entry.
   */
  moveSide?: { hours: number; pct: number } | undefined;
}

/** ADR-122: which side of a strangle a move leaves to sell: the one behind it. */
export type MoveSide = "put" | "call" | "both";
export function sideAfterMove(spot: number, spotBefore: number, pct: number): { movePct: number; side: MoveSide } {
  const movePct = (spot / spotBefore - 1) * 100;
  return { movePct, side: movePct > pct ? "put" : movePct < -pct ? "call" : "both" };
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
const EVENING = { fromHourUtc: 16, toHourUtc: 17, window: "9:30 to 10:30 PM IST", describe: "once an evening, 9:30 to 10:30 PM IST, on the next expiry", maxDte: 1.5, venues: ["delta_india"] } as const;
const STUDY = "docs/research/scripts/autopilot-study (106 BTC daily expiries, 8 Aug to 21 Nov 2026, 5-minute marks, the exchange's real fees, 100 lots)";
const STUDY_TRIALS = { count: 456, note: "19 structures at 24 entry hours on the same 106 days, with several exits each, and for the stopped strangle five more exits tried afterwards (take half at two stops; trail the rest at three give-backs, of which 50 % was the best; close the rest at once); these were chosen after seeing the results, so their figures are in-sample and the paper record is the test" };
/** Never judged by the daily record (it enters at the settlement hour, the worst hour of the study): Autopilot's own results are the record. */
const NO_RECORD: PlaybookThresholds = { minTrades: Number.MAX_SAFE_INTEGER, netPositive: true, outOfSamplePositive: true };
const clockPlaybook = (id: string, name: string, summary: string, rationale: string, claim: string, template: StrategyTemplate, legStop?: number, takeProfitOfCredit?: number, trailRestPct?: number): Playbook => ({
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
  clock: { ...EVENING, legStop, takeProfitOfCredit, trailRestPct },
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
    "The same trade further from the price: it wins more often and earns less each time. The far wings had a price on about half the days only, so this is the thinnest record of them all.",
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
  clockPlaybook(
    "evening-strangle-trail-rest",
    "Evening strangle, trail the rest",
    "Each evening sell a call and a put three strikes out on the next expiry; buy either one back if its price doubles, then trail the profit on the other and close it when it gives back half of its best.",
    "The owner's question: after one side is stopped, a reversal can stop the other too. Trailing the side that is left gives up part of its premium for a smaller worst day. Beside the stop-at-double one it differs from in this rule only.",
    "Sold 600 away, entered 21:30 IST, each option stopped at twice its price, the other side then trailed with a give-back of half its best: +6.45 a day on 106 days, 45 % of days positive, worst day -42; keeping the other side to settlement instead averaged +7.51 with a worst day of -60. A stop was hit on 64 of the 106 days.",
    strangle("Evening strangle (3)", 3, null),
    2,
    undefined,
    50,
  ),
];

// ---- ADR-115: the weekly strangles, entered on a Friday or a Tuesday evening for the Friday expiry -----------------

const WEEKLY_STUDY = "docs/research/scripts/autopilot-study/results-weekly-2026-11-22.txt (51 BTC Friday expiries, 5 Dec 2025 to 20 Nov 2026, hourly marks, the exchange's real fees, 100 lots)";
const WEEKLY_TRIALS = { count: 147, note: "3 naked strangles (3, 5 and 7 % away) at 7 entry days and 6 exits and 3 winged ones at 7 entry days, on the same 51 weeks, and the monthly cycle looked at and left out; the Friday entries were chosen for their results and the Tuesday ones are run although they were about flat, as a check of the backtest; in-sample, the paper record is the test" };
/** Sell the call and the put `sold` per cent of the spot away; with `wing`, buy the options that far away to cap the loss. */
function strangleAway(name: string, sold: number, wing: number | null, expiry = "weekly"): StrategyTemplate {
  const legs = [{ ...P_SELL, k: 0, pct: -sold }, { ...C_SELL, k: 0, pct: sold }];
  return {
    name,
    category: "Neutral",
    description: wing === null ? `Sell a call and a put ${sold} % out of the money on the ${expiry} expiry.` : `Sell a call and a put ${sold} % out of the money on the ${expiry} expiry and buy the options ${wing} % out to cap the loss.`,
    legs: wing === null ? legs : [{ ...P_BUY, k: 0, pct: -wing }, ...legs, { ...C_BUY, k: 0, pct: wing }],
    risk: wing === null ? "undefined" : "defined",
  };
}
/** 16:00 to 17:00 UTC on the entry day; the Friday expiry settles at 12:00 UTC: a week less four hours later from a Friday, three days less four hours from a Tuesday. */
const WEEKLY_DAYS = {
  fri: { weekdayUtc: 5, day: "Friday", minDte: 6.5, maxDte: 7.5, describe: "each Friday, 9:30 to 10:30 PM IST, on next Friday's expiry" },
  tue: { weekdayUtc: 2, day: "Tuesday", minDte: 2.5, maxDte: 3.5, describe: "each Tuesday, 9:30 to 10:30 PM IST, on that week's Friday expiry" },
} as const;
type WeeklyExit = { key: string; name: string; exit: string; wing: number | null; legStop?: number; takeProfitOfCredit?: number; trailRestPct?: number; fri: string; tue: string };
const WEEKLY_EXITS: readonly WeeklyExit[] = [
  { key: "wings", name: "with wings", exit: "buy the options 7 % away as wings, and hold to settlement", wing: 7, fri: "+35.58 a week on 26 weeks (the wings had a price on about half), 73 % of weeks positive, worst week -246", tue: "+9.03 a week on 21 weeks, 62 % positive, worst week -183, and a loss over the second half of the year" },
  { key: "stop-2x", name: "stop at double", exit: "buy either one back if its price doubles, and hold the other to settlement", wing: null, legStop: 2, fri: "+28.33 a week on 51 weeks, 43 % of weeks positive, worst week -268", tue: "+0.50 a week on 47 weeks, 38 % positive, worst week -121" },
  { key: "stop-3x", name: "stop at triple", exit: "buy either one back if its price triples, and hold the other to settlement", wing: null, legStop: 3, fri: "+40.65 a week on 51 weeks, 57 % of weeks positive, worst week -168, positive in both halves of the year", tue: "-2.92 a week on 47 weeks, 51 % positive, worst week -171" },
  { key: "take-half", name: "take half", exit: "close the whole trade once it is up by half the premium, and buy either option back if its price doubles", wing: null, legStop: 2, takeProfitOfCredit: 0.5, fri: "+14.52 a week on 51 weeks, 51 % of weeks positive, worst week -268", tue: "+0.35 a week on 47 weeks, 51 % positive, worst week -121" },
  { key: "trail-rest", name: "trail the rest", exit: "buy either one back if its price doubles, then trail the profit on the other and close it when it gives back half of its best", wing: null, legStop: 2, trailRestPct: 50, fri: "+23.52 a week on 51 weeks, 41 % of weeks positive, worst week -230", tue: "-3.60 a week on 47 weeks, 38 % positive, worst week -121" },
];
const weeklyPlaybook = (d: keyof typeof WEEKLY_DAYS, x: WeeklyExit): Playbook => {
  const when = WEEKLY_DAYS[d];
  return {
    id: `weekly-${d}-strangle-${x.key}`,
    name: `${when.day} weekly strangle, ${x.name}`,
    summary: `Each ${when.day} evening sell a call and a put 3 % away on the ${d === "fri" ? "next" : "coming"} Friday expiry; ${x.exit}.`,
    rationale: d === "fri" ? "A week of time value sold with its loss bounded by a stop or by wings: in the study every such version entered a Friday for the next was positive in both halves of the year, and the version with neither lost 1,220 in its worst week." : "The same trade entered three days before expiry. In the study it was about flat with a stop and a little positive with wings; it runs on paper as a check of that result, not because it earned.",
    evidence: { claim: `Sold 3 % away, entered ${when.day} 21:30 IST for the Friday expiry: ${x[d]}.`, source: WEEKLY_STUDY },
    template: strangleAway(`${when.day} weekly strangle${x.wing === null ? "" : " with wings"} (3 %)`, 3, x.wing),
    minDte: when.minDte,
    lots: 100,
    assets: ["BTC"],
    thresholds: NO_RECORD,
    trials: WEEKLY_TRIALS,
    control: false,
    clock: { fromHourUtc: 16, toHourUtc: 17, weekdayUtc: when.weekdayUtc, window: `${when.day}s, 9:30 to 10:30 PM IST`, describe: when.describe, maxDte: when.maxDte, venues: ["delta_india"], legStop: x.legStop, takeProfitOfCredit: x.takeProfitOfCredit, trailRestPct: x.trailRestPct },
  };
};
/** The weekly playbooks Autopilot enters by the clock (ADR-115): five exits, each on a Friday and on a Tuesday. */
export const WEEKLY_PLAYBOOKS: readonly Playbook[] = (["fri", "tue"] as const).flatMap((d) => WEEKLY_EXITS.map((x) => weeklyPlaybook(d, x)));

// ---- ADR-117: strikes by premium, and the monthly strangles -------------------------------------------------------

const PREMIUM_STUDY = "docs/research/scripts/autopilot-study (study_premium.py and study_monthly.py; results-premium-daily, results-premium-weekly and results-monthly-BTC of 22 Nov 2026; BTC, 100 lots, the exchange's real fees)";
const PREMIUM_TRIALS = { count: 432, note: "6 premium levels daily, 5 weekly on two entry days and 7 monthly shapes in four entry ranges naked and with wings, each under 6 exits, on the same data as the other studies; a monthly figure is the mean over every entry day of its range (they overlap) while Autopilot takes the first evening only; chosen after seeing the results, so the figures are in-sample and the paper record is the test" };
/** Sell the call and the put each priced nearest `premium` (per unit of the underlying), or each `pct` per cent of the spot away. */
function strangleBy(name: string, how: { premium: number } | { pct: number }): StrategyTemplate {
  const by = "premium" in how ? { put: { premium: how.premium }, call: { premium: how.premium } } : { put: { pct: -how.pct }, call: { pct: how.pct } };
  return {
    name,
    category: "Neutral",
    description: "premium" in how ? `Sell the out-of-the-money call and put each priced nearest ${how.premium}.` : `Sell a call and a put ${how.pct} % out of the money.`,
    legs: [{ ...P_SELL, k: 0, ...by.put }, { ...C_SELL, k: 0, ...by.call }],
    risk: "undefined",
  };
}
const HOURS = { fromHourUtc: 16, toHourUtc: 17, venues: ["delta_india"] } as const;
const premiumPlaybook = (o: { id: string; name: string; summary: string; rationale: string; claim: string; template: StrategyTemplate; minDte: number; clock: Omit<PlaybookClock, "fromHourUtc" | "toHourUtc" | "venues"> }): Playbook => ({
  id: o.id,
  name: o.name,
  summary: o.summary,
  rationale: o.rationale,
  evidence: { claim: o.claim, source: PREMIUM_STUDY },
  template: o.template,
  minDte: o.minDte,
  lots: 100,
  assets: ["BTC"],
  thresholds: NO_RECORD,
  trials: PREMIUM_TRIALS,
  control: false,
  clock: { ...HOURS, ...o.clock },
});

/** The daily and the weekly strangle sold by premium: the level a competitor is said to sell at, with the stop and the take that tested best there. */
export const PREMIUM_PLAYBOOKS: readonly Playbook[] = [
  premiumPlaybook({
    id: "evening-strangle-premium-100",
    name: "Evening strangle, 100 a side",
    summary: "Each evening sell the call and the put each priced nearest 100 on the next expiry; close the whole trade at half the premium, and buy either option back if its price triples.",
    rationale: "Strikes chosen by what they pay, not by distance: on a quiet day they sit closer, on a wild day further. At 100 a side (about 1.6 % away) it earns less than the closer strangles and had the highest share of winning days and the smallest worst day of the levels tried.",
    claim: "Each side priced near 100, entered 21:30 IST, each option stopped at three times its price, the whole trade closed at half the premium: +4.25 a day on 106 days, 84 % positive, worst day -55; both halves of the period positive. At 300 a side with the stop alone: +10.79 a day, worst day -148.",
    template: strangleBy("Evening strangle (100 a side)", { premium: 100 }),
    minDte: 0.5,
    clock: { window: "9:30 to 10:30 PM IST", describe: "once an evening, 9:30 to 10:30 PM IST, on the next expiry", maxDte: 1.5, legStop: 3, takeProfitOfCredit: 0.5 },
  }),
  premiumPlaybook({
    id: "weekly-fri-strangle-premium-200",
    name: "Friday weekly strangle, 200 a side",
    summary: "Each Friday evening sell the call and the put each priced nearest 200 on the next Friday expiry; close the whole trade at half the premium, and buy either option back if its price triples.",
    rationale: "The weekly trade far from the price: at 200 a side the strikes sit about 7.6 % away. It earns a fifth of the 3 %-away version with a worst week under half as large. Entered on a Tuesday the same trade under these exits was flat or negative at every premium, so there is no Tuesday version.",
    claim: "Each side priced near 200, entered Friday 21:30 IST for the next Friday, each option stopped at three times its price, the whole trade closed at half the premium: +7.26 a week on 51 weeks, 78 % positive, worst week -68; both halves of the year positive. With no stop the same trade lost 1,140 in its worst week.",
    template: strangleBy("Friday weekly strangle (200 a side)", { premium: 200 }),
    minDte: 6.5,
    clock: { weekdayUtc: 5, window: "Fridays, 9:30 to 10:30 PM IST", describe: "each Friday, 9:30 to 10:30 PM IST, on next Friday's expiry", maxDte: 7.5, legStop: 3, takeProfitOfCredit: 0.5 },
  }),
];

type MonthlyExit = { sold: number; wing: number | null; key: string; name: string; exit: string; why: string; rule: string; figures: string; legStop?: number; take?: number; trail?: number };
/** ADR-118: the other exits of the daily and weekly sets on the monthly expiry, and wings with a stop: all on the shape entered one month out. */
const MONTHLY_EXITS: readonly MonthlyExit[] = [
  { sold: 12, wing: null, key: "stop-2x", name: "stop at double", exit: "buy either one back if its price doubles, and hold the other to settlement", why: "The stop alone, with no take: it earned a little more on average than taking half and was positive in fewer expiries.", rule: "each option stopped at twice its price", figures: "+66.20 a trade on 165 entries over 11 expiries, 7 of them positive, 48 % positive, worst entry -300", legStop: 2 },
  { sold: 12, wing: null, key: "stop-3x", name: "stop at triple", exit: "buy either one back if its price triples, and hold the other to settlement", why: "The looser stop alone.", rule: "each option stopped at three times its price", figures: "+71.30 a trade on 165 entries over 11 expiries, 7 of them positive, 52 % positive, worst entry -199", legStop: 3 },
  { sold: 12, wing: null, key: "trail-rest", name: "trail the rest", exit: "buy either one back if its price doubles, then trail the profit on the other and close it when it gives back half of its best", why: "After a stop the other side is trailed instead of kept.", rule: "each option stopped at twice its price, the other side then trailed by half", figures: "+60.90 a trade on 165 entries over 11 expiries, 7 of them positive, 45 % positive, worst entry -173", legStop: 2, trail: 50 },
  { sold: 12, wing: 18, key: "wings", name: "with wings", exit: "buy the options 18 % away as wings, and hold to settlement", why: "Wings and nothing else LOST in the study, as did every monthly shape held to settlement: it runs on paper as a check of that, not because it earned.", rule: "held to settlement", figures: "-105.10 a trade on 165 entries over 11 expiries, 6 of them positive, 58 % positive, worst entry -526" },
  { sold: 12, wing: 18, key: "wings-stop-3x", name: "wings and a stop at triple", exit: "buy the options 18 % away as wings; buy a sold option back if its price triples and keep everything else to settlement", why: "The best monthly result of the study: when a sold option is stopped the wing behind it is kept, and in a month that keeps trending the wing pays. Positive in every one of the eleven expiries, on wing prices that are model marks: the paper record has to confirm it.", rule: "each sold option stopped at three times its price, the wings kept", figures: "+209.10 a trade on 165 entries over 11 expiries, 11 of them positive, 92 % positive, worst entry -266", legStop: 3 },
  { sold: 12, wing: 18, key: "wings-take-half", name: "wings, stop at triple, take half", exit: "buy the options 18 % away as wings; close the whole trade at half the premium, and buy a sold option back if its price triples", why: "The same with the quick profit: it wins more often and earns far less, because the take closes the trade before a kept wing can pay.", rule: "each sold option stopped at three times its price, the whole trade closed at half the premium", figures: "+33.60 a trade on 165 entries over 11 expiries, 9 of them positive, 94 % positive, worst entry -266", legStop: 3, take: 0.5 },
  { sold: 8, wing: 12, key: "wings-take-half", name: "wings, stop at triple, take half", exit: "buy the options 12 % away as wings; close the whole trade at half the premium, and buy a sold option back if its price triples", why: "Closer strikes with wings and the quick profit: the highest share of winning entries of the study, positive in every expiry.", rule: "each sold option stopped at three times its price, the whole trade closed at half the premium", figures: "+54.80 a trade on 165 entries over 11 expiries, 11 of them positive, 98 % positive, worst entry -428", legStop: 3, take: 0.5 },
];
const MONTHLY_FAR = { cadence: "monthly", oncePerExpiry: true, window: "any evening, 9:30 to 10:30 PM IST", describe: "on the first evening a month-end expiry is 60 to 75 days out, once per expiry", maxDte: 75 } as const;
/**
 * The monthly strangles (ADR-117). Held with no stop, or with wings, a monthly strangle LOST at every level tried; with
 * a stop on each option and the whole trade closed at half the premium it was positive in 7 to 10 of 11 expiries.
 */
export const MONTHLY_PLAYBOOKS: readonly Playbook[] = [
  premiumPlaybook({
    id: "monthly-strangle-premium-1000",
    name: "Monthly strangle, 1,000 a side",
    summary: "Two months before a month-end expiry sell the call and the put each priced nearest 1,000; close the whole trade at half the premium, and buy either option back if its price triples.",
    rationale: "The trade a competitor is said to run: far strikes (about 20 % away) on the expiry two months out. Held to settlement it lost in the study; it is the take at half the premium that made it pay, usually within the first weeks.",
    claim: "Each side priced near 1,000, entered 60 to 75 days before expiry, each option stopped at three times its price, the whole trade closed at half the premium: +44.80 a trade on 176 entries over 11 expiries, 8 of them positive, 77 % positive, worst entry -507. Held with no stop the same entries averaged -139.",
    template: strangleBy("Monthly strangle (1,000 a side)", { premium: 1000 }),
    minDte: 60,
    clock: { ...MONTHLY_FAR, legStop: 3, takeProfitOfCredit: 0.5 },
  }),
  premiumPlaybook({
    id: "monthly-strangle-8pct",
    name: "Monthly strangle, 8 % away",
    summary: "Two months before a month-end expiry sell a call and a put 8 % away; close the whole trade at half the premium, and buy either option back if its price doubles.",
    rationale: "The same timing with strikes much closer, so far more premium: under a stop at twice and the take at half it had the best average of the naked monthly shapes and the largest single losses. On paper beside the far version to see which the take at half suits.",
    claim: "Sold 8 % away, entered 60 to 75 days before expiry, each option stopped at twice its price, the whole trade closed at half the premium: +102.70 a trade on 176 entries over 11 expiries, 9 of them positive, 69 % positive, worst entry -698. The same with the stop at three times averaged +161.00 with a worst entry of -1,130.",
    template: strangleBy("Monthly strangle (8 % away)", { pct: 8 }),
    minDte: 60,
    clock: { ...MONTHLY_FAR, legStop: 2, takeProfitOfCredit: 0.5 },
  }),
  premiumPlaybook({
    id: "monthly-strangle-12pct-near",
    name: "Monthly strangle, 12 % away, one month out",
    summary: "A month before a month-end expiry sell a call and a put 12 % away; close the whole trade at half the premium, and buy either option back if its price doubles.",
    rationale: "The nearer month: less time to wait and the steadiest of the monthly shapes, with its worst expiry about flat.",
    claim: "Sold 12 % away, entered 30 to 44 days before expiry, each option stopped at twice its price, the whole trade closed at half the premium: +45.90 a trade on 165 entries over 11 expiries, 9 of them positive, 65 % positive, worst entry -300.",
    template: strangleBy("Monthly strangle (12 % away)", { pct: 12 }),
    minDte: 30,
    clock: { cadence: "monthly", oncePerExpiry: true, window: "any evening, 9:30 to 10:30 PM IST", describe: "on the first evening a month-end expiry is 30 to 44 days out, once per expiry", maxDte: 44, legStop: 2, takeProfitOfCredit: 0.5 },
  }),
  // ---- every exit on one shape (12 % away, one month out), as the daily and weekly sets have, and the winged ones -----
  ...MONTHLY_EXITS.map((x) =>
    premiumPlaybook({
      id: `monthly-strangle-${x.sold}pct-near-${x.key}`,
      // short: a strategy opened from it is named "<name> · Autopilot", and a strategy name holds 80 characters (GAPS #153)
      name: `Monthly ${x.sold} %, 1 month out, ${x.name}`,
      summary: `A month before a month-end expiry sell a call and a put ${x.sold} % away; ${x.exit}.`,
      rationale: x.why,
      claim: `Sold ${x.sold} % away${x.wing === null ? "" : `, wings ${x.wing} % away`}, entered 30 to 44 days before expiry, ${x.rule}: ${x.figures}.`,
      template: x.wing === null ? strangleBy(`Monthly strangle (${x.sold} % away)`, { pct: x.sold }) : strangleAway(`Monthly strangle with wings (${x.sold} % / ${x.wing} %)`, x.sold, x.wing),
      minDte: 30,
      clock: { cadence: "monthly", oncePerExpiry: true, window: "any evening, 9:30 to 10:30 PM IST", describe: "on the first evening a month-end expiry is 30 to 44 days out, once per expiry", maxDte: 44, legStop: x.legStop, takeProfitOfCredit: x.take, trailRestPct: x.trail },
    }),
  ),
];

// ---- ADR-119: the same strangles on ETH and XAUT, each from that coin's own backtest ------------------------------

const ALT_DAILY_STUDY = "docs/research/scripts/autopilot-study/results-daily-ETH-2026-11-22.txt and results-daily-XAUT-2026-11-22.txt (study_premium.py; ETH: 106 daily expiries, entered 21:30 IST for the 17:30 IST settlement; XAUT: the 91 expiries of the same days (none on a Sunday), which settle at 21:30 IST, entered the hour after the previous one; 8 Aug to 21 Nov 2026, 5-minute marks, the exchange's real fees, 100 lots)";
const ALT_DAILY_TRIALS = { count: 2532, note: "ETH: 9 strangles (4 by premium, 5 by distance) at 3 entry hours, and XAUT: 8 (3 by premium, 5 by distance) at 23 entry hours, each naked and with wings under 6 exits, on the same 106 days; the distances and exits were chosen after seeing the results, so the figures are in-sample and the paper record is the test" };
type AltExit = { asset: "ETH" | "XAUT"; key: string; name: string; sold: number; wing: number | null; exit: string; why: string; rule: string; figures: string; legStop?: number; take?: number; trail?: number };
const ALT_COIN = { ETH: "ETH", XAUT: "Gold" } as const;
const ALT_DAILY: readonly AltExit[] = [
  { asset: "ETH", key: "wings", name: "with wings", sold: 1.5, wing: 3.75, exit: "buy the options 3.75 % away as wings, and hold to settlement", why: "The bounded version: the wings cap the loss, so it needs no stop. Its worst day was under half that of the same strikes held with no wings (-135).", rule: "wings 3.75 % away, held to settlement", figures: "+4.22 a day on 105 days, 83 % of days positive, worst day -59" },
  { asset: "ETH", key: "stop-2x", name: "stop at double", sold: 1, wing: null, exit: "buy either one back if its price doubles, and hold the other to settlement", why: "The usual way a sold strangle is run. On ETH the stop at double was hit by ordinary swings on about half the days.", rule: "each option stopped at twice its price", figures: "+2.83 a day on 106 days, 49 % of days positive, worst day -50", legStop: 2 },
  { asset: "ETH", key: "stop-3x", name: "stop at triple", sold: 1, wing: null, exit: "buy either one back if its price triples, and hold the other to settlement", why: "The best ETH daily result with a stop: more room than the stop at double for the same worst day. Held with no stop the same trade averaged +6.67 with a worst day of -138.", rule: "each option stopped at three times its price", figures: "+4.46 a day on 106 days, 61 % of days positive, worst day -50", legStop: 3 },
  { asset: "ETH", key: "take-half", name: "take half", sold: 1, wing: null, exit: "close the whole trade once it is up by half the premium, and buy either option back if its price triples", why: "The quick-profit version. On ETH the take did better behind the stop at triple than behind the stop at double (+2.20), so that is the one run.", rule: "each option stopped at three times its price, the whole trade closed at half the premium", figures: "+3.10 a day on 106 days, 75 % of days positive, worst day -45", legStop: 3, take: 0.5 },
  { asset: "ETH", key: "trail-rest", name: "trail the rest", sold: 1, wing: null, exit: "buy either one back if its price doubles, then trail the profit on the other and close it when it gives back half of its best", why: "After a stop the other side is trailed instead of kept. On ETH it made almost no difference to the stop at double it is otherwise identical to.", rule: "each option stopped at twice its price, the other side then trailed by half", figures: "+2.79 a day on 106 days, 49 % of days positive, worst day -50", legStop: 2, trail: 50 },
  { asset: "ETH", key: "wings-take-half", name: "wide, wings, take half", sold: 2, wing: 5, exit: "buy the options 5 % away as wings; close the whole trade at half the premium, and buy a sold option back if its price triples", why: "The steadiest ETH daily result: far strikes, wings, a stop and the quick profit. It earns less each day and had the smallest worst day of the six ETH daily versions here, by a wide margin.", rule: "wings 5 % away, each sold option stopped at three times its price, the whole trade closed at half the premium", figures: "+2.88 a day on 103 days, 90 % of days positive, worst day -16", legStop: 3, take: 0.5 },
  // Gold settles at 16:00 UTC (21:30 IST), so the evening window is the hour after one expiry settles: a full day before the next
  { asset: "XAUT", key: "stop-2x", name: "stop at double", sold: 1, wing: null, exit: "buy either one back if its price doubles, and hold the other to settlement", why: "Gold's edge is thin: of the 23 entry hours tried, the hour after the previous expiry earned the most, the two hours after it less, and the rest of the day lost. The amounts are small because 100 lots is a tenth of an ounce. With wings it earned about half as much, on the 77 days the wings had a price, so there is no winged version.", rule: "each option stopped at twice its price", figures: "+0.19 a day on 91 days, 48 % of days positive, worst day -2.1", legStop: 2 },
  { asset: "XAUT", key: "stop-3x", name: "stop at triple", sold: 1, wing: null, exit: "buy either one back if its price triples, and hold the other to settlement", why: "The looser stop earned less on Gold than the stop at double, unlike on BTC and ETH: on paper beside it to see whether that holds.", rule: "each option stopped at three times its price", figures: "+0.11 a day on 91 days, 49 % of days positive, worst day -3.1", legStop: 3 },
  { asset: "XAUT", key: "take-half", name: "take half", sold: 1, wing: null, exit: "close the whole trade once it is up by half the premium, and buy either option back if its price doubles", why: "The steadiest Gold version: the same average as the stop alone with more winning days and the smallest worst day, positive in both halves of the period.", rule: "each option stopped at twice its price, the whole trade closed at half the premium", figures: "+0.19 a day on 91 days, 67 % of days positive, worst day -1.4", legStop: 2, take: 0.5 },
  { asset: "XAUT", key: "trail-rest", name: "trail the rest", sold: 1, wing: null, exit: "buy either one back if its price doubles, then trail the profit on the other and close it when it gives back half of its best", why: "After a stop the other side is trailed instead of kept: a little less than keeping it, for the same worst day.", rule: "each option stopped at twice its price, the other side then trailed by half", figures: "+0.16 a day on 91 days, 45 % of days positive, worst day -2.1", legStop: 2, trail: 50 },
];
const altDailyPlaybook = (x: AltExit): Playbook => ({
  id: `${x.asset.toLowerCase()}-evening-strangle-${x.key}`,
  name: `${ALT_COIN[x.asset]} evening strangle, ${x.name}`,
  summary: `Each evening sell a ${ALT_COIN[x.asset]} call and put ${x.sold} % away on the next expiry; ${x.exit}.`,
  rationale: x.why,
  evidence: { claim: `${x.asset}, sold ${x.sold} % away, entered 21:30 IST${x.asset === "XAUT" ? ", a day before its settlement" : ""}, ${x.rule}: ${x.figures}.`, source: ALT_DAILY_STUDY },
  template: strangleAway(`${ALT_COIN[x.asset]} evening strangle${x.wing === null ? "" : " with wings"} (${x.sold} %)`, x.sold, x.wing, "next"),
  minDte: 0.5,
  lots: 100,
  assets: [x.asset],
  thresholds: NO_RECORD,
  trials: ALT_DAILY_TRIALS,
  control: false,
  clock: { ...EVENING, legStop: x.legStop, takeProfitOfCredit: x.take, trailRestPct: x.trail },
});
/** The evening strangles on ETH and XAUT (ADR-119): strikes a percentage of the spot away, since a count of listed strikes means a different distance on each coin. */
export const ALT_DAILY_PLAYBOOKS: readonly Playbook[] = ALT_DAILY.map(altDailyPlaybook);
const ALT_WEEKLY_STUDY = "docs/research/scripts/autopilot-study/results-weekly-ETH-2026-11-22.txt (study_premium.py; 51 ETH Friday expiries, 5 Dec 2025 to 20 Nov 2026, hourly marks, the exchange's real fees, 100 lots); XAUT weekly was studied too (results-weekly-XAUT-2026-11-22.txt) and has no playbook: its options had a price in 16 or 17 of the 51 weeks and none a full week ahead, and what there was came out flat or negative";
const ALT_WEEKLY_TRIALS = { count: 360, note: "ETH: 5 distances (3 to 8 % away) on two entry days, naked and with wings, under 6 exits, on the same 51 weeks (120); XAUT: 5 distances on four entry days the same way (240, of which 162 had prices); the distance and the exits were chosen after seeing the results, so the figures are in-sample and the paper record is the test" };
type AltWeekly = { d: keyof typeof WEEKLY_DAYS; key: string; name: string; sold: number; wing: number | null; exit: string; why: string; rule: string; figures: string; legStop?: number; take?: number };
const ALT_WEEKLY: readonly AltWeekly[] = [
  { d: "fri", key: "wings", name: "with wings", sold: 4, wing: 9.3, exit: "buy the options 9.3 % away as wings, and hold to settlement", why: "The bounded version. On ETH the wings had a price in 44 of the 51 weeks, and it earned less than half of the stopped one with a larger worst week: on paper as the comparison.", rule: "wings 9.3 % away, held to settlement", figures: "+6.32 a week on 44 weeks, 73 % of weeks positive, worst week -191" },
  { d: "fri", key: "stop-2x", name: "stop at double", sold: 4, wing: null, exit: "buy either one back if its price doubles, and hold the other to settlement", why: "On ETH a week is long enough for the stop at double to be hit by ordinary swings: it earned a seventh of the stop at triple. On paper as a check of that.", rule: "each option stopped at twice its price", figures: "+2.00 a week on 51 weeks, 49 % of weeks positive, worst week -106", legStop: 2 },
  { d: "fri", key: "stop-3x", name: "stop at triple", sold: 4, wing: null, exit: "buy either one back if its price triples, and hold the other to settlement", why: "The best ETH weekly result: positive in both halves of the year. Held with no stop the same trade averaged +11.74 with a worst week of -582.", rule: "each option stopped at three times its price", figures: "+14.43 a week on 51 weeks, 57 % of weeks positive, worst week -83", legStop: 3 },
  { d: "fri", key: "take-half", name: "take half", sold: 4, wing: null, exit: "close the whole trade once it is up by half the premium, and buy either option back if its price triples", why: "About the same average as the stop alone with far more winning weeks and a smaller worst one, positive in both halves of the year: the steadiest ETH weekly version.", rule: "each option stopped at three times its price, the whole trade closed at half the premium", figures: "+14.08 a week on 51 weeks, 75 % of weeks positive, worst week -72", legStop: 3, take: 0.5 },
  { d: "tue", key: "stop-3x", name: "stop at triple", sold: 3, wing: null, exit: "buy either one back if its price triples, and hold the other to settlement", why: "The same trade entered three days before expiry, closer to the price. Unlike on BTC the Tuesday entry earned on ETH, in both halves of the year; the other Tuesday versions were weak.", rule: "each option stopped at three times its price", figures: "+9.03 a week on 51 weeks, 57 % of weeks positive, worst week -82", legStop: 3 },
];
const altWeeklyPlaybook = (x: AltWeekly): Playbook => {
  const when = WEEKLY_DAYS[x.d];
  return {
    id: `eth-weekly-${x.d}-strangle-${x.key}`,
    name: `ETH ${when.day} weekly strangle, ${x.name}`,
    summary: `Each ${when.day} evening sell an ETH call and put ${x.sold} % away on the ${x.d === "fri" ? "next" : "coming"} Friday expiry; ${x.exit}.`,
    rationale: x.why,
    evidence: { claim: `ETH, sold ${x.sold} % away, entered ${when.day} 21:30 IST for the Friday expiry, ${x.rule}: ${x.figures}.`, source: ALT_WEEKLY_STUDY },
    template: strangleAway(`ETH ${when.day} weekly strangle${x.wing === null ? "" : " with wings"} (${x.sold} %)`, x.sold, x.wing),
    minDte: when.minDte,
    lots: 100,
    assets: ["ETH"],
    thresholds: NO_RECORD,
    trials: ALT_WEEKLY_TRIALS,
    control: false,
    clock: { fromHourUtc: 16, toHourUtc: 17, weekdayUtc: when.weekdayUtc, window: `${when.day}s, 9:30 to 10:30 PM IST`, describe: when.describe, maxDte: when.maxDte, venues: ["delta_india"], legStop: x.legStop, takeProfitOfCredit: x.take },
  };
};
/** The weekly strangles on ETH (ADR-119). There is none on XAUT: see the study's note. */
export const ALT_WEEKLY_PLAYBOOKS: readonly Playbook[] = ALT_WEEKLY.map(altWeeklyPlaybook);
const ALT_MONTHLY_STUDY = "docs/research/scripts/autopilot-study/results-monthly-ETH-2026-11-22.txt (study_monthly.py; the 11 ETH month-end expiries of 2026, hourly marks, the exchange's real fees, 100 lots)";
const ALT_MONTHLY_TRIALS = { count: 384, note: "8 ETH shapes (3 by premium, 5 by distance from 8 to 20 % away), naked and with wings, in four entry ranges under 6 exits, on the same 11 expiries (336 of the 384 had prices); a figure is the mean over every entry day of its range (they overlap) while Autopilot takes the first evening only; the winged figures rest on far-wing marks that are model prices; chosen after seeing the results, so in-sample, and the paper record is the test" };
const ALT_MONTHLY_RANGES = {
  near: { minDte: 30, maxDte: 44, words: "A month before", days: "30 to 44", label: "1 month out" },
  far: { minDte: 60, maxDte: 75, words: "Two months before", days: "60 to 75", label: "2 months out" },
} as const;
type AltMonthly = { range: keyof typeof ALT_MONTHLY_RANGES; sold: number; wing: number | null; key: string; name: string; exit: string; why: string; rule: string; figures: string; legStop: number; take?: number };
const ALT_MONTHLY: readonly AltMonthly[] = [
  { range: "far", sold: 16, wing: 24, key: "wings-stop-3x", name: "wings, stop at triple", exit: "buy the options 24 % away as wings; buy a sold option back if its price triples and keep everything else to settlement", why: "ETH moves further in a month than BTC, so the strikes sit further out. As on BTC, wings with a stop was the strongest monthly shape: a kept wing pays when the month keeps trending. Held with no stop the same trade lost.", rule: "wings 24 % away, each sold option stopped at three times its price, the wings kept", figures: "+88.30 a trade on 157 entries over 11 expiries, 10 of them positive, 83 % positive, worst entry -250", legStop: 3 },
  { range: "far", sold: 16, wing: 24, key: "wings-take-half", name: "wings, stop at triple, take half", exit: "buy the options 24 % away as wings; close the whole trade at half the premium, and buy a sold option back if its price triples", why: "The same with the quick profit: far less on average and almost every entry a winner, positive in all eleven expiries.", rule: "wings 24 % away, each sold option stopped at three times its price, the whole trade closed at half the premium", figures: "+33.60 a trade on 157 entries over 11 expiries, 11 of them positive, 98 % positive, worst entry -250", legStop: 3, take: 0.5 },
  { range: "near", sold: 12, wing: null, key: "stop-2x", name: "stop at double", exit: "buy either one back if its price doubles, and hold the other to settlement", why: "The nearer month with the stop alone. Held with no stop the same trade averaged -96 with a worst entry of -767.", rule: "each option stopped at twice its price", figures: "+34.30 a trade on 165 entries over 11 expiries, 9 of them positive, 59 % positive, worst entry -84", legStop: 2 },
  { range: "near", sold: 12, wing: null, key: "take-half", name: "take half", exit: "close the whole trade once it is up by half the premium, and buy either option back if its price doubles", why: "The steadiest naked ETH monthly shape: about the same average as the stop alone, more winning entries, the smallest worst entry, positive in ten of eleven expiries.", rule: "each option stopped at twice its price, the whole trade closed at half the premium", figures: "+32.10 a trade on 165 entries over 11 expiries, 10 of them positive, 72 % positive, worst entry -69", legStop: 2, take: 0.5 },
  { range: "near", sold: 12, wing: 18, key: "wings-stop-3x", name: "wings, stop at triple", exit: "buy the options 18 % away as wings; buy a sold option back if its price triples and keep everything else to settlement", why: "The winged shape on the nearer month: the highest average of the ETH monthly set, positive in eight of eleven expiries, on wing prices that are model marks.", rule: "wings 18 % away, each sold option stopped at three times its price, the wings kept", figures: "+102.30 a trade on 165 entries over 11 expiries, 8 of them positive, 79 % positive, worst entry -184", legStop: 3 },
];
const altMonthlyPlaybook = (x: AltMonthly): Playbook => {
  const r = ALT_MONTHLY_RANGES[x.range];
  return {
    id: `eth-monthly-strangle-${x.sold}pct-${x.range}-${x.key}`,
    // short: a strategy opened from it is named "<name> · Autopilot", and a strategy name holds 80 characters (GAPS #153)
    name: `ETH monthly ${x.sold} %, ${r.label}, ${x.name}`,
    summary: `${r.words} a month-end expiry sell an ETH call and put ${x.sold} % away; ${x.exit}.`,
    rationale: x.why,
    evidence: { claim: `ETH, sold ${x.sold} % away, entered ${r.days} days before expiry, ${x.rule}: ${x.figures}.`, source: ALT_MONTHLY_STUDY },
    template: x.wing === null ? strangleBy(`ETH monthly strangle (${x.sold} % away)`, { pct: x.sold }) : strangleAway(`ETH monthly strangle with wings (${x.sold} % / ${x.wing} %)`, x.sold, x.wing, "month-end"),
    minDte: r.minDte,
    lots: 100,
    assets: ["ETH"],
    thresholds: NO_RECORD,
    trials: ALT_MONTHLY_TRIALS,
    control: false,
    clock: { ...HOURS, cadence: "monthly", oncePerExpiry: true, window: "any evening, 9:30 to 10:30 PM IST", describe: `on the first evening a month-end expiry is ${r.days} days out, once per expiry`, maxDte: r.maxDte, legStop: x.legStop, takeProfitOfCredit: x.take },
  };
};
/** The monthly strangles on ETH (ADR-119). */
export const ALT_MONTHLY_PLAYBOOKS: readonly Playbook[] = ALT_MONTHLY.map(altMonthlyPlaybook);
/** Every clock playbook of the other coins, in the order the screen lists them: daily, weekly, monthly. */
export const ALT_PLAYBOOKS: readonly Playbook[] = [...ALT_DAILY_PLAYBOOKS, ...ALT_WEEKLY_PLAYBOOKS, ...ALT_MONTHLY_PLAYBOOKS];

// ---- ADR-120: the profit ladder on the three sets it was backtested on -----------------------------------------------

const LADDER_STUDY = "docs/research/scripts/autopilot-study/results-scale-out-2026-11-22.txt (study_premium.py with the scale argument; BTC and ETH daily on 106 expiries, 8 Aug to 21 Nov 2026, 5-minute marks; BTC weekly on 51 Friday expiries, hourly marks; the exchange's real fees, 100 lots)";
const LADDER_TRIALS = { count: 36, note: "takes at 25, 50 and 75 % of the premium and the four-part ladder, under a stop at double and at triple, on the three sets (24), and the strategy lab's early and late ladders of three and five parts on the same data (12); in the backtest each quarter is its own small trade and carries its share of a stopped option's loss, while the engine measures the lots still open only, so after a stop the steps come sooner here than in these figures; chosen after seeing the results, in-sample, and the paper record is the test" };
const LADDER_LEVELS = [25, 50, 75] as const;
const ladderPlaybook = (o: { id: string; name: string; asset: PlaybookAsset; coin: string; sold: number; weekly: boolean; figures: string; why: string }): Playbook => ({
  id: o.id,
  name: o.name,
  summary: `${o.weekly ? "Each Friday evening" : "Each evening"} sell ${o.coin} call and put ${o.sold} % away on the ${o.weekly ? "next Friday" : "next"} expiry; close a quarter of the lots when the open ones are up by 25 %, by 50 % and by 75 % of their premium, hold the last quarter, and buy either option back if its price triples.`,
  rationale: o.why,
  evidence: { claim: `${o.asset}, sold ${o.sold} % away, entered ${o.weekly ? "Friday " : ""}21:30 IST${o.weekly ? " for the next Friday" : ""}, each option stopped at three times its price, a quarter closed at 25, 50 and 75 % of the premium and a quarter held: ${o.figures}.`, source: LADDER_STUDY },
  template: strangleAway(`${o.name.split(",")[0]!} (${o.sold} %)`, o.sold, null, o.weekly ? "weekly" : "next"),
  minDte: o.weekly ? WEEKLY_DAYS.fri.minDte : 0.5,
  lots: 100,
  assets: [o.asset],
  thresholds: NO_RECORD,
  trials: LADDER_TRIALS,
  control: false,
  clock: o.weekly
    ? { fromHourUtc: 16, toHourUtc: 17, weekdayUtc: WEEKLY_DAYS.fri.weekdayUtc, window: "Fridays, 9:30 to 10:30 PM IST", describe: WEEKLY_DAYS.fri.describe, maxDte: WEEKLY_DAYS.fri.maxDte, venues: ["delta_india"], legStop: 3, ladder: LADDER_LEVELS }
    : { ...EVENING, legStop: 3, ladder: LADDER_LEVELS },
});
/** The owner's profit ladder (ADR-120) on the daily sets: profit banked in four parts instead of all at once. */
export const LADDER_DAILY_PLAYBOOKS: readonly Playbook[] = [
  ladderPlaybook({ id: "evening-strangle-steps", name: "Evening strangle, profit steps", asset: "BTC", coin: "a", sold: 1, weekly: false, figures: "+8.88 a day on 106 days, 72 % of days positive, worst day -50.5", why: "The owner's idea: a sudden move can turn an open profit into a loss, so bank it in parts. In the study it earned about what closing everything at half does (+9.02) with a smaller worst day (-69), and less than holding with the stop alone (+11.75, worst -106)." }),
  ladderPlaybook({ id: "eth-evening-strangle-steps", name: "ETH evening strangle, profit steps", asset: "ETH", coin: "an ETH", sold: 1, weekly: false, figures: "+3.15 a day on 106 days, 65 % of days positive, worst day -44.6", why: "The same ladder on ETH: about what closing everything at half does (+3.10) for the same worst day, and less than the stop alone (+4.46)." }),
];
/** The profit ladder on the BTC Friday weekly. */
export const LADDER_WEEKLY_PLAYBOOKS: readonly Playbook[] = [
  ladderPlaybook({ id: "weekly-fri-strangle-steps", name: "Friday weekly strangle, profit steps", asset: "BTC", coin: "a", sold: 3, weekly: true, figures: "+33.25 a week on 51 weeks, 65 % of weeks positive, worst week -168.3", why: "The ladder on the weekly trade, where it did better against closing everything at half (+28.59) and gave up less against the stop alone (+40.65) than on the daily ones; the worst week is the same for all three." }),
];

// ---- ADR-121: the ideas the strategy lab tested and the owner approved, each as a strategy of its own -----------------------

const LAB_STUDY = "the strategy lab's tables (branch research/exits, docs/research/scripts/autopilot-study: study_exits.py, results-exits-BTC-daily, -ETH-daily, -BTC-weekly, results-exits-early-out, results-entry-closer-BTC / -ETH and results-wings-daily of 22 Nov 2026) and results-half-then-trail-2026-11-22.txt; 106 daily expiries, 8 Aug to 21 Nov 2026, 5-minute marks, and 51 Friday expiries, hourly marks; the exchange's real fees, 100 lots)";
const LAB_TRIALS = { count: 2150, note: "the lab's exit tables (a profit lock at three levels, timed exits at several hours, an exit near the strike, ladders: 167 rows on each of four sets), its entry tables (strikes from 0.25 to 2 % away at several hours: 624 rows on each of two coins), its wings and early-out tables (172 rows) and the half-then-trail table (56): about 2,150 rows, of which these ten were picked after seeing them; in-sample on one period, judged on bar closes, and the paper record is the test" };
type LabSpec = { id: string; name: string; asset: PlaybookAsset; sold: number; wing?: number; weekly?: true; summary: string; why: string; rule: string; entered?: string; figures: string; clock: Partial<PlaybookClock>; minDte?: number };
const labPlaybook = (o: LabSpec): Playbook => ({
  id: o.id,
  name: o.name,
  summary: o.summary,
  rationale: o.why,
  evidence: { claim: `${o.asset}, sold ${o.sold} % away, entered ${o.entered ?? (o.weekly ? "Friday 21:30 IST for the next Friday" : "21:30 IST")}, ${o.rule}: ${o.figures}.`, source: LAB_STUDY },
  template: strangleAway(`${o.name.split(",")[0]!} (${o.sold} %)`, o.sold, o.wing ?? null, o.weekly ? "weekly" : "next"),
  minDte: o.minDte ?? (o.weekly ? WEEKLY_DAYS.fri.minDte : 0.5),
  lots: 100,
  assets: [o.asset],
  thresholds: NO_RECORD,
  trials: LAB_TRIALS,
  control: false,
  clock: o.weekly
    ? { fromHourUtc: 16, toHourUtc: 17, weekdayUtc: WEEKLY_DAYS.fri.weekdayUtc, window: "Fridays, 9:30 to 10:30 PM IST", describe: WEEKLY_DAYS.fri.describe, maxDte: WEEKLY_DAYS.fri.maxDte, venues: ["delta_india"], ...o.clock }
    : { ...EVENING, ...o.clock },
});
const LOCK = { at: 0.5, floor: 0.25 } as const;
const LOCK_WORDS = "once the trade is up by half the premium a floor is set at a quarter of it, and the whole trade is closed if the profit falls back there; otherwise it is held to settlement. Either option is bought back if its price triples";
/** 20:00 UTC is 01:30 IST: four hours after the evening entry, sixteen before the settlement. */
const OUT_EARLY_HOUR_UTC = 20;
/** The daily ones: a profit lock, out by 1:30 AM, strikes half as far, half then trail, ETH with wings at 3 %, and an afternoon entry. */
export const LAB_DAILY_PLAYBOOKS: readonly Playbook[] = [
  labPlaybook({ id: "evening-strangle-lock", name: "Evening strangle, profit lock", asset: "BTC", sold: 1, summary: `Each evening sell a call and a put 1 % away on the next expiry; ${LOCK_WORDS}.`, why: "The owner's worry answered with a floor instead of an early exit: a trade that has been well up is closed when it falls back to the floor (a jump through the floor between two checks closes below it). In the study it earned what the stop alone does (+11.75) with more winning days and a smaller worst day (-106 for the stop alone). On ETH it earned less than the stop alone, so there is none there.", rule: "each option stopped at three times its price, a floor at 25 % of the premium once the profit has reached 50 %", figures: "+11.68 a day on 106 days, 71 % of days positive, worst day -69.2", clock: { legStop: 3, lock: LOCK } }),
  labPlaybook({ id: "evening-strangle-out-early", name: "Evening strangle, out by 1:30 AM", asset: "BTC", sold: 1, summary: "Each evening sell a call and a put 1 % away on the next expiry and close everything at 1:30 AM IST, whatever the profit; either option is bought back before that if its price triples.", why: "Four hours of the trade and none of the next day: about half the average of holding to settlement (+11.75) for a quarter of its worst day (-106). For a trader who would rather sleep than hold.", rule: "each option stopped at three times its price, everything closed at 01:30 IST", figures: "+6.18 a day on 106 days, 78 % of days positive, worst day -25", clock: { legStop: 3, exitHourUtc: OUT_EARLY_HOUR_UTC } }),
  labPlaybook({ id: "eth-evening-strangle-out-early", name: "ETH evening strangle, out by 1:30 AM", asset: "ETH", sold: 1, summary: "Each evening sell an ETH call and put 1 % away on the next expiry and close everything at 1:30 AM IST, whatever the profit; either option is bought back before that if its price triples.", why: "The same on ETH. The hour matters here: closing an hour later the worst day was back to about -50.", rule: "each option stopped at three times its price, everything closed at 01:30 IST", figures: "+2.58 a day on 106 days, 82 % of days positive, worst day -19.9", clock: { legStop: 3, exitHourUtc: OUT_EARLY_HOUR_UTC } }),
  labPlaybook({ id: "evening-strangle-close", name: "Evening strangle, half a per cent away", asset: "BTC", sold: 0.5, summary: "Each evening sell a call and a put 0.5 % away on the next expiry; buy either one back if its price triples, and hold the other to settlement.", why: "The bolder version: strikes half as far, so more premium and more of it lost on a bad day. In the study it earned more than 1 % away (+11.75) with a slightly larger worst day (-106) and a few fewer winning days.", rule: "each option stopped at three times its price, held to settlement", figures: "+14.60 a day on 106 days, 62 % of days positive, worst day -114.4", clock: { legStop: 3 } }),
  labPlaybook({ id: "eth-evening-strangle-close", name: "ETH evening strangle, half a per cent away", asset: "ETH", sold: 0.5, summary: "Each evening sell an ETH call and put 0.5 % away on the next expiry; buy either one back if its price triples, and hold the other to settlement.", why: "The bolder version on ETH: more than 1 % away earned (+4.46) for about the same worst day (-50).", rule: "each option stopped at three times its price, held to settlement", figures: "+6.84 a day on 106 days, 64 % of days positive, worst day -50.6", clock: { legStop: 3 } }),
  labPlaybook({ id: "evening-strangle-half-trail", name: "Evening strangle, half then trail", asset: "BTC", sold: 1, summary: "Each evening sell a call and a put 1 % away on the next expiry; once the trade is up by half the premium do not close it: trail it, and close when the profit gives back a fifth of its best. Either option is bought back if its price triples.", why: "The owner's idea, and the middle of the three daily bundles: most of what the stop alone earns (+11.75) with the smaller worst day of taking half (-69) and nearly as many winning days. A sold strangle cannot make more than its premium, so from half there is at most the other half to gain.", rule: "each option stopped at three times its price; from half the premium the profit is trailed with a give-back of 20 % of its best", figures: "+11.30 a day on 106 days, 79 % of days positive, worst day -69.2", clock: { legStop: 3, takeProfitOfCredit: 0.5, takeTrailPct: 20 } }),
  labPlaybook({ id: "eth-evening-strangle-half-trail", name: "ETH evening strangle, half then trail", asset: "ETH", sold: 1, summary: "Each evening sell an ETH call and put 1 % away on the next expiry; once the trade is up by half the premium trail it, and close when the profit gives back a fifth of its best. Either option is bought back if its price triples.", why: "The same on ETH: more than closing at half (+3.10) and less than the stop alone (+4.46), for the smaller worst day.", rule: "each option stopped at three times its price; from half the premium the profit is trailed with a give-back of 20 % of its best", figures: "+3.65 a day on 106 days, 75 % of days positive, worst day -44.6", clock: { legStop: 3, takeProfitOfCredit: 0.5, takeTrailPct: 20 } }),
  labPlaybook({ id: "eth-evening-strangle-wings-near", name: "ETH evening strangle, wings at 3 %", asset: "ETH", sold: 1, wing: 3, summary: "Each evening sell an ETH call and put 1 % away on the next expiry and buy the options 3 % away as wings; hold to settlement with no stop.", why: "The bounded ETH trade with the strikes at 1 %: the wings cap the loss, so it carries no stop. With a stop at triple on the sold options it earned about half (+2.33): the stop takes the sold option and leaves its wing behind. The wing prices are model marks of far strikes; a real wing may cost more. On BTC the same wings earned about half of what the stop alone does (+5.62 against +11.75), so there is none there.", rule: "wings 3 % away, held to settlement", figures: "+4.56 a day on 105 days, 73 % of days positive, worst day -47", clock: {} }),
  labPlaybook({ id: "afternoon-strangle-take-half", name: "Afternoon strangle, take half", asset: "BTC", sold: 0.25, minDte: 0.04, summary: "Each afternoon, two hours before the day's settlement, sell a call and a put 0.25 % away on that expiry; close the whole trade at half the premium, and buy either option back if its price triples.", why: "One to watch, not a recommendation: the lab found a small edge in the last two hours on BTC with strikes very close, weak in the first half of the period and absent on ETH. On paper to see whether it is there at all.", entered: "15:30 IST, two hours before settlement", rule: "each option stopped at three times its price, the whole trade closed at half the premium", figures: "+2.29 a day on 106 days, 75 % of days positive, worst day -21.7", clock: { fromHourUtc: 10, toHourUtc: 11, window: "3:30 to 4:30 PM IST", describe: "once an afternoon, 3:30 to 4:30 PM IST, on that day's expiry", maxDte: 0.3, legStop: 3, takeProfitOfCredit: 0.5 } }),
];
/** The profit lock on the BTC Friday weekly. */
export const LAB_WEEKLY_PLAYBOOKS: readonly Playbook[] = [
  labPlaybook({ id: "weekly-fri-strangle-lock", name: "Friday weekly strangle, profit lock", asset: "BTC", sold: 3, weekly: true, summary: `Each Friday evening sell a call and a put 3 % away on the next Friday expiry; ${LOCK_WORDS}.`, why: "The lock on the weekly trade: the average of the stop alone (+40.65) with far more winning weeks (57 % for the stop alone) and the same worst week.", rule: "each option stopped at three times its price, a floor at 25 % of the premium once the profit has reached 50 %", figures: "+40.95 a week on 51 weeks, 71 % of weeks positive, worst week -168.3", clock: { legStop: 3, lock: LOCK } }),
];

// ---- ADR-122: one side after a move, the lab's trend table -------------------------------------------------------------------

const MOVE_STUDY = "the strategy lab's trend table (branch research/exits, docs/research/scripts/autopilot-study: study_trend.py, results-trend-2026-11-22.txt, \"spot move over the 24 h before the entry, beyond 1 %\", \"only the side behind the move\"; 105 daily expiries with a spot 24 hours earlier, 8 Aug to 21 Nov 2026, 5-minute marks; the exchange's real fees, 100 lots)";
const MOVE_TRIALS = { count: 72, note: "the lab's trend table (four look-backs and three thresholds, each with three alternatives to selling both sides always, on each of two coins: 72 rows, beside the per-side figures they were built from), of which this rule was picked after seeing them; in-sample on one period in which moves continued more often than they reversed, judged on bar closes, and the paper record is the test" };
const MOVE = { hours: 24, pct: 1 } as const;
const movePlaybook = (o: { id: string; name: string; asset: PlaybookAsset; coin: string; why: string; figures: string }): Playbook => ({
  ...labPlaybook({ id: o.id, name: o.name, asset: o.asset, sold: 1, summary: `Each evening look at the move of the last 24 hours: after a rise of more than 1 % sell only ${o.coin} put 1 % away on the next expiry, after a fall of more than 1 % only the call, otherwise both. Each sold option is bought back if its price triples; the rest is held to settlement.`, why: o.why, rule: "after a move of more than 1 % over 24 hours only the side behind it (up: the put, down: the call), otherwise both; each option stopped at three times its price", figures: o.figures, clock: { legStop: 3, moveSide: MOVE } }),
  trials: MOVE_TRIALS,
});
const moveEvidence = (p: Playbook): Playbook => ({ ...p, evidence: { ...p.evidence, source: MOVE_STUDY } });
/** One side after a move (ADR-122), on BTC and ETH daily. */
export const MOVE_DAILY_PLAYBOOKS: readonly Playbook[] = [
  movePlaybook({ id: "evening-strangle-one-side", name: "Evening strangle, one side after a move", asset: "BTC", coin: "the", figures: "+10.73 a day on 105 days, 72 % of days positive, worst day -73.4", why: "In the study the option ahead of a move earned less than the one behind it, and carried the worst days: moves went on more often than they reversed. Selling only the side behind the move earned a little less than both sides always (+11.76 on the same days) with more winning days (65 % for both sides) and a smaller worst day (-105.8). It earned less in the second half of the period than in the first, as both sides always did. One trending period: in a ranging market the opposite could hold. A single sold option has nothing on the other side to offset it." }),
  movePlaybook({ id: "eth-evening-strangle-one-side", name: "ETH evening strangle, one side after a move", asset: "ETH", coin: "the ETH", figures: "+3.91 a day on 105 days, 69 % of days positive, worst day -40.1", why: "The same on ETH: a little less than both sides always (+4.42 on the same days) with more winning days (61 % for both sides) and a smaller worst day (-49.6). It earned less in the second half of the period than in the first." }),
].map(moveEvidence);

// ---- ADR-123: a sold option bought back once it is nearly worthless, the lab's cheap-leg table ------------------------------

const BUYBACK_STUDY = "the strategy lab's cheap-leg table (branch research/exits, docs/research/scripts/autopilot-study: study_cheap.py, results-cheap-leg-2026-11-22.txt, \"BTC daily: buy a sold leg back alone when its mark falls to a fixed price\", the row at a mark of 5; 106 daily expiries, 8 Aug to 21 Nov 2026, 5-minute marks; the exchange's real fees with the buy-back's counted, 100 lots)";
const BUYBACK_TRIALS = { count: 40, note: "the lab's cheap-leg table (a buy-back at four fixed prices and at four shares of the entry price, on five sets: 40 rows). No fixed price beat holding on BTC daily; a buy-back at 20 % of the entry price did (+13.34 against +11.75) and is not what the owner asked for. This one is the owner's level, taken as protection and not for income; in-sample on one period, judged on bar closes at mark prices, and the paper record is the test" };
/** The mark, in USD, a sold BTC option is bought back at. */
const BUYBACK_AT = 5;
/** A sold option bought back at 5 dollars (ADR-123), on BTC daily. */
export const BUYBACK_DAILY_PLAYBOOKS: readonly Playbook[] = [
  labPlaybook({ id: "evening-strangle-buy-back", name: "Evening strangle, buy back at 5 dollars", asset: "BTC", sold: 1, summary: "Each evening sell a call and a put 1 % away on the next expiry. Once either option's price has fallen to 5 dollars it is bought back on its own: almost nothing is left to earn on it and it can still come back. Either option is closed at a loss if its price triples (its stop); what is left is held to settlement.", why: "The owner's idea, from a day when a call sold at 421 fell to 5 and came back above 600 as the price ran through its strike. Protection, not income: in the study it earned a little less than holding (+11.75) with the worst day within a dollar of holding's (-105.8), because nearly every option that cheap expires worthless anyway. Of 163 options that fell to 5, 9 later rose above 50, 2 went on to their stop and none settled above the price it was sold at; the highest any reached was 184, so a day like the owner's is outside the sample. On an exchange an option marked at 5 often cannot be bought at 5: the real cost is higher than the paper one.", rule: "each option stopped at three times its price, and bought back alone once its price has fallen to 5 dollars", figures: "+11.30 a day on 106 days, 66 % of days positive, worst day -106.3", clock: { legStop: 3, legBuyBackAt: BUYBACK_AT } }),
].map((p) => ({ ...p, trials: BUYBACK_TRIALS, evidence: { ...p.evidence, source: BUYBACK_STUDY } }));

/** Every playbook Autopilot may trade: the recorded ones (never the control) and the ones entered by the clock. */
export const AUTOPILOT_PLAYBOOKS: readonly Playbook[] = [...PLAYBOOKS.filter((p) => !p.control), ...CLOCK_PLAYBOOKS, ...PREMIUM_PLAYBOOKS.filter((p) => p.clock!.weekdayUtc === undefined), ...ALT_DAILY_PLAYBOOKS, ...LADDER_DAILY_PLAYBOOKS, ...LAB_DAILY_PLAYBOOKS, ...MOVE_DAILY_PLAYBOOKS, ...BUYBACK_DAILY_PLAYBOOKS, ...WEEKLY_PLAYBOOKS, ...PREMIUM_PLAYBOOKS.filter((p) => p.clock!.weekdayUtc !== undefined), ...ALT_WEEKLY_PLAYBOOKS, ...LADDER_WEEKLY_PLAYBOOKS, ...LAB_WEEKLY_PLAYBOOKS, ...MONTHLY_PLAYBOOKS, ...ALT_MONTHLY_PLAYBOOKS];
export function autopilotPlaybookById(id: string): Playbook | undefined {
  return AUTOPILOT_PLAYBOOKS.find((p) => p.id === id);
}

/** ADR-117: a month-end expiry is the last Friday of its month (YYYY-MM-DD): the one a monthly playbook trades. */
export function isMonthEndExpiry(expiry: string): boolean {
  const d = new Date(`${expiry}T00:00:00Z`);
  return d.getUTCDay() === 5 && new Date(d.getTime() + 7 * 86_400_000).getUTCMonth() !== d.getUTCMonth();
}

/** ADR-116: how often a playbook trades, which is how the Autopilot screen sorts them. `trend`: when its market condition is met. */
export const PLAYBOOK_CADENCES = ["trend", "daily", "weekly", "monthly"] as const;
export type PlaybookCadence = (typeof PLAYBOOK_CADENCES)[number];
export function playbookCadence(p: Playbook): PlaybookCadence {
  if (!p.clock) return "trend";
  return p.clock.cadence ?? (p.clock.weekdayUtc === undefined ? "daily" : "weekly");
}

/** A clock playbook's backtest as figures (the same ones its evidence sentence quotes), for a table: USD per trade at the playbook's size. */
export interface PlaybookBacktest {
  /** Mean net result per trade. */
  mean: number;
  /** What one trade is: a day's, a week's, or (monthly: entries of one expiry overlap, so it is not "a month") a trade. */
  per: "day" | "week" | "trade";
  /** Share of trades that ended positive, in per cent. */
  positivePct: number;
  /** The worst single trade. */
  worst: number;
  /** Trades in the sample. */
  samples: number;
  /** What the sample is when it is not simply that many days or weeks (monthly: entry days over how many expiries, and how many of those were positive). */
  basis?: string | undefined;
}
const bt = (mean: number, per: PlaybookBacktest["per"], positivePct: number, worst: number, samples: number, basis?: string): PlaybookBacktest => ({ mean, per, positivePct, worst, samples, basis });
const mo = (mean: number, positivePct: number, worst: number, samples: number, expiriesPositive: number, expiries = 11): PlaybookBacktest => bt(mean, "trade", positivePct, worst, samples, `${samples} entry days over ${expiries} expiries, ${expiriesPositive} positive`);
const BACKTESTS: Record<string, PlaybookBacktest> = {
  "evening-strangle-wings-3": bt(5.93, "day", 73, -78, 84),
  "evening-strangle-wings-5": bt(7.68, "day", 89, -90, 55),
  "evening-strangle-stop-2x": bt(7.51, "day", 45, -60, 106),
  "evening-strangle-stop-3x": bt(12.0, "day", 61, -98, 106),
  "evening-strangle-take-half": bt(6.75, "day", 59, -60, 106),
  "evening-strangle-trail-rest": bt(6.45, "day", 45, -42, 106),
  "weekly-fri-strangle-wings": bt(35.58, "week", 73, -246, 26),
  "weekly-fri-strangle-stop-2x": bt(28.33, "week", 43, -268, 51),
  "weekly-fri-strangle-stop-3x": bt(40.65, "week", 57, -168, 51),
  "weekly-fri-strangle-take-half": bt(14.52, "week", 51, -268, 51),
  "weekly-fri-strangle-trail-rest": bt(23.52, "week", 41, -230, 51),
  "weekly-tue-strangle-wings": bt(9.03, "week", 62, -183, 21),
  "weekly-tue-strangle-stop-2x": bt(0.5, "week", 38, -121, 47),
  "weekly-tue-strangle-stop-3x": bt(-2.92, "week", 51, -171, 47),
  "weekly-tue-strangle-take-half": bt(0.35, "week", 51, -121, 47),
  "weekly-tue-strangle-trail-rest": bt(-3.6, "week", 38, -121, 47),
  "evening-strangle-premium-100": bt(4.25, "day", 84, -55, 106),
  "weekly-fri-strangle-premium-200": bt(7.26, "week", 78, -68, 51),
  "monthly-strangle-premium-1000": mo(44.8, 77, -507, 176, 8),
  "monthly-strangle-8pct": mo(102.7, 69, -698, 176, 9),
  "monthly-strangle-12pct-near": mo(45.9, 65, -300, 165, 9),
  "monthly-strangle-12pct-near-stop-2x": mo(66.2, 48, -300, 165, 7),
  "monthly-strangle-12pct-near-stop-3x": mo(71.3, 52, -199, 165, 7),
  "monthly-strangle-12pct-near-trail-rest": mo(60.9, 45, -173, 165, 7),
  "monthly-strangle-12pct-near-wings": mo(-105.1, 58, -526, 165, 6),
  "monthly-strangle-12pct-near-wings-stop-3x": mo(209.1, 92, -266, 165, 11),
  "monthly-strangle-12pct-near-wings-take-half": mo(33.6, 94, -266, 165, 9),
  "monthly-strangle-8pct-near-wings-take-half": mo(54.8, 98, -428, 165, 11),
  "eth-evening-strangle-wings": bt(4.22, "day", 83, -59, 105),
  "eth-evening-strangle-stop-2x": bt(2.83, "day", 49, -50, 106),
  "eth-evening-strangle-stop-3x": bt(4.46, "day", 61, -50, 106),
  "eth-evening-strangle-take-half": bt(3.1, "day", 75, -45, 106),
  "eth-evening-strangle-trail-rest": bt(2.79, "day", 49, -50, 106),
  "eth-evening-strangle-wings-take-half": bt(2.88, "day", 90, -16, 103),
  "xaut-evening-strangle-stop-2x": bt(0.19, "day", 48, -2.1, 91),
  "xaut-evening-strangle-stop-3x": bt(0.11, "day", 49, -3.1, 91),
  "xaut-evening-strangle-take-half": bt(0.19, "day", 67, -1.4, 91),
  "xaut-evening-strangle-trail-rest": bt(0.16, "day", 45, -2.1, 91),
  "eth-weekly-fri-strangle-wings": bt(6.32, "week", 73, -191, 44),
  "eth-weekly-fri-strangle-stop-2x": bt(2.0, "week", 49, -106, 51),
  "eth-weekly-fri-strangle-stop-3x": bt(14.43, "week", 57, -83, 51),
  "eth-weekly-fri-strangle-take-half": bt(14.08, "week", 75, -72, 51),
  "eth-weekly-tue-strangle-stop-3x": bt(9.03, "week", 57, -82, 51),
  "evening-strangle-steps": bt(8.88, "day", 72, -50.5, 106),
  "eth-evening-strangle-steps": bt(3.15, "day", 65, -44.6, 106),
  "weekly-fri-strangle-steps": bt(33.25, "week", 65, -168.3, 51),
  "evening-strangle-lock": bt(11.68, "day", 71, -69.2, 106),
  "evening-strangle-out-early": bt(6.18, "day", 78, -25, 106),
  "eth-evening-strangle-out-early": bt(2.58, "day", 82, -19.9, 106),
  "evening-strangle-close": bt(14.6, "day", 62, -114.4, 106),
  "eth-evening-strangle-close": bt(6.84, "day", 64, -50.6, 106),
  "afternoon-strangle-take-half": bt(2.29, "day", 75, -21.7, 106),
  "evening-strangle-half-trail": bt(11.3, "day", 79, -69.2, 106),
  "evening-strangle-one-side": bt(10.73, "day", 72, -73.4, 105),
  "evening-strangle-buy-back": bt(11.3, "day", 66, -106.3, 106),
  "eth-evening-strangle-one-side": bt(3.91, "day", 69, -40.1, 105),
  "eth-evening-strangle-half-trail": bt(3.65, "day", 75, -44.6, 106),
  "eth-evening-strangle-wings-near": bt(4.56, "day", 73, -47, 105),
  "weekly-fri-strangle-lock": bt(40.95, "week", 71, -168.3, 51),
  "eth-monthly-strangle-16pct-far-wings-stop-3x": mo(88.3, 83, -250, 157, 10),
  "eth-monthly-strangle-16pct-far-wings-take-half": mo(33.6, 98, -250, 157, 11),
  "eth-monthly-strangle-12pct-near-stop-2x": mo(34.3, 59, -84, 165, 9),
  "eth-monthly-strangle-12pct-near-take-half": mo(32.1, 72, -69, 165, 10),
  "eth-monthly-strangle-12pct-near-wings-stop-3x": mo(102.3, 79, -184, 165, 8),
};
/** The backtest figures of a playbook entered by the clock; undefined for a recorded playbook (its record is live data). */
export function playbookBacktest(id: string): PlaybookBacktest | undefined {
  return BACKTESTS[id];
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
  /** ADR-122: the move the entry was judged on (per cent over the playbook's look-back) and the side it left to sell. */
  move?: { movePct: number; side: MoveSide } | undefined;
}
export type ProposalSkip = EntrySkip | "control" | "noDays" | "noMove";
export type ProposalResult = { ok: true; proposal: PlaybookProposal } | { ok: false; reason: ProposalSkip };

/**
 * Whether the playbook's plan enters on the latest recorded day and, when it does, the concrete structure: exactly the
 * entry the record would have taken, through the same `entryFor` the backtest uses. The control never proposes.
 */
export function proposalFor(p: Playbook, daysIn: readonly EodDay[], base: { unitsPerLot: number; calendar: BacktestOptions["calendar"]; spotBefore?: number | null | undefined }): ProposalResult {
  if (p.control) return { ok: false, reason: "control" };
  const tpl = playbookTemplate(p);
  if (!tpl || daysIn.length === 0) return { ok: false, reason: "noDays" };
  const days = [...daysIn].sort((a, b) => a.day.localeCompare(b.day));
  const i = days.length - 1;
  const entry = entryFor(days, i, tpl, { lots: p.lots, unitsPerLot: base.unitsPerLot, minDte: p.minDte, calendar: base.calendar, conditions: p.conditions, expiryOk: p.clock?.cadence === "monthly" ? isMonthEndExpiry : undefined });
  if (!entry.ok) return { ok: false, reason: entry.reason };
  const d = days[i]!;
  // ADR-122: a playbook that sells one side after a move needs the earlier spot; without it there is nothing to judge
  const before = base.spotBefore;
  if (p.clock?.moveSide && !(typeof before === "number" && before > 0)) return { ok: false, reason: "noMove" };
  const move = p.clock?.moveSide ? sideAfterMove(d.spot, before!, p.clock.moveSide.pct) : undefined;
  const kept = entry.legs.map((_, j) => j).filter((j) => !move || move.side === "both" || entry.legs[j]!.kind === move.side);
  const legs = kept.map((j) => entry.legs[j]!);
  const entryCost = legs.reduce((sum, l) => sum + (l.kind === "future" ? 0 : (l.side === "buy" ? 1 : -1) * l.quantity * l.price), 0);
  const { maxProfit, maxLoss } = expiryExtremes(legs);
  return { ok: true, proposal: { day: d.day, spot: d.spot, expiry: entry.expiry, legs: kept.map((j) => entry.placed[j]!), entryCost, maxProfit, maxLoss, ...(move ? { move } : {}) } };
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

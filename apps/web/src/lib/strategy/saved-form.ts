// The editor of a saved Autopilot strategy as plain data (ADR-141, ADR-142; HC-TR-278): what the admin types, and its
// conversion to and from the settings the API keeps. The screen shows India time and India weekdays; the engine keeps
// whole UTC hours and UTC weekdays, so the conversion lives here, in one place, and is tested on its own.
import { type Playbook, playbookTemplate } from "@hapiecoin/pricing";
import { SAVED_LONG_WINDOW_HOURS, SavedBacktest, type SavedCadence, SavedDefinition, type SavedLeg, type SavedStrategy, type Underlying, savedIstClock, savedIstWeekday } from "@hapiecoin/schema";

/** A UTC hour as the clock reads in India (UTC + 5:30), as every Autopilot card writes it: "9:30 PM". 24 is 5:30 the next morning. */
export const istClock = (hourUtc: number): string => {
  const c = savedIstClock(hourUtc);
  return `${c.time} ${c.half}`;
};
/** The UTC hours a window may start at, in the order of the India day (05:30 first). */
export const FROM_HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** India is a day ahead of UTC from 18:30 UTC: a window that starts at 19:00 UTC or later opens on the next India day. */
const dayShift = (fromHourUtc: number): number => (fromHourUtc >= 19 ? 1 : 0);
export const utcWeekday = (istDay: number, fromHourUtc: number): number => (istDay - dayShift(fromHourUtc) + 7) % 7;
export const istWeekday = savedIstWeekday;

export interface LegForm { kind: SavedLeg["kind"]; side: SavedLeg["side"]; by: SavedLeg["by"]; value: string }
export interface SavedForm {
  name: string;
  summary: string;
  assets: Underlying[];
  lots: string;
  cadence: SavedCadence;
  anyTime: boolean;
  fromHourUtc: number;
  toHourUtc: number;
  /** weekly: the India weekday the window opens on. */
  weekday: number;
  /** daily: the India weekdays allowed; empty: every day. */
  weekdays: number[];
  oncePerExpiry: boolean;
  minDte: string;
  maxDte: string;
  legs: LegForm[];
  smaOn: boolean;
  smaDays: string;
  smaSide: "above" | "below";
  ivOn: boolean;
  ivMin: string;
  ivMax: string;
  ivLookback: string;
  moveOn: boolean;
  moveHours: string;
  movePct: string;
  legStop: string;
  /** Per cent of the premium collected. */
  takeProfitPct: string;
  takeTrailPct: string;
  trailRestPct: string;
  /** Levels separated by commas, in per cent. */
  ladder: string;
  lockAtPct: string;
  lockFloorPct: string;
  /** "" or a UTC hour. */
  exitHourUtc: string;
  buyBackBy: "none" | "price" | "share";
  buyBackValue: string;
  btMean: string;
  btPer: "day" | "week" | "trade";
  btPositivePct: string;
  btWorst: string;
  btSamples: string;
  btBasis: string;
  audience: SavedStrategy["audience"];
  userIds: string[];
  planIds: string[];
}

const leg = (kind: SavedLeg["kind"], side: SavedLeg["side"], value: string): LegForm => ({ kind, side, by: "pct", value });
/** Starting points for "What to trade": distances in per cent of the spot. */
export const LEG_PRESETS: Record<"strangle" | "wings" | "put" | "call", { label: string; legs: () => LegForm[] }> = {
  strangle: { label: "Strangle", legs: () => [leg("put", "sell", "2"), leg("call", "sell", "2")] },
  wings: { label: "Strangle with wings", legs: () => [leg("put", "buy", "4"), leg("put", "sell", "2"), leg("call", "sell", "2"), leg("call", "buy", "4")] },
  put: { label: "Sold put", legs: () => [leg("put", "sell", "2")] },
  call: { label: "Sold call", legs: () => [leg("call", "sell", "2")] },
};

/** A new strategy: the evening strangle the built-in daily ones start from, with nothing else set. */
export const emptySavedForm = (): SavedForm => ({
  name: "",
  summary: "",
  assets: ["BTC"],
  lots: "100",
  cadence: "daily",
  anyTime: false,
  fromHourUtc: 16,
  toHourUtc: 17,
  weekday: 5,
  weekdays: [],
  oncePerExpiry: false,
  minDte: "0.5",
  maxDte: "1.5",
  legs: LEG_PRESETS.strangle.legs(),
  smaOn: false,
  smaDays: "50",
  smaSide: "above",
  ivOn: false,
  ivMin: "",
  ivMax: "",
  ivLookback: "90",
  moveOn: false,
  moveHours: "24",
  movePct: "2",
  legStop: "",
  takeProfitPct: "",
  takeTrailPct: "",
  trailRestPct: "",
  ladder: "",
  lockAtPct: "",
  lockFloorPct: "",
  exitHourUtc: "",
  buyBackBy: "none",
  buyBackValue: "",
  btMean: "",
  btPer: "day",
  btPositivePct: "",
  btWorst: "",
  btSamples: "",
  btBasis: "",
  audience: "admins",
  userIds: [],
  planIds: [],
});

const str = (n: number | undefined): string => (n === undefined ? "" : String(n));
/** A share between 0 and 1 as the per cent the screen shows, without float noise (0.55 is 55, not 55.00000000000001). */
const pct = (share: number | undefined): string => (share === undefined ? "" : String(Number((share * 100).toFixed(6))));

export function savedFormOf(s: SavedStrategy): SavedForm {
  const d = s.definition;
  const anyTime = d.fromHourUtc === 0 && d.toHourUtc === 24;
  const from = anyTime ? 16 : d.fromHourUtc;
  const e = d.exits;
  const b = s.backtest;
  return {
    ...emptySavedForm(),
    name: s.name,
    summary: s.summary,
    assets: [...d.assets],
    lots: String(d.lots),
    cadence: d.cadence,
    anyTime,
    fromHourUtc: from,
    toHourUtc: anyTime ? 17 : d.toHourUtc,
    weekday: d.weekdayUtc === undefined ? 5 : istWeekday(d.weekdayUtc, anyTime ? 0 : d.fromHourUtc),
    weekdays: (d.weekdays ?? []).map((w) => istWeekday(w, anyTime ? 0 : d.fromHourUtc)).sort((x, y) => x - y),
    oncePerExpiry: d.oncePerExpiry,
    minDte: String(d.minDte),
    maxDte: String(d.maxDte),
    legs: d.legs.map((l) => ({ kind: l.kind, side: l.side, by: l.by, value: String(l.value) })),
    smaOn: d.conditions?.sma !== undefined,
    smaDays: str(d.conditions?.sma?.days) || "50",
    smaSide: d.conditions?.sma?.side ?? "above",
    ivOn: d.conditions?.ivRank !== undefined,
    ivMin: str(d.conditions?.ivRank?.min),
    ivMax: str(d.conditions?.ivRank?.max),
    ivLookback: str(d.conditions?.ivRank?.lookbackDays) || "90",
    moveOn: d.moveSide !== undefined,
    moveHours: str(d.moveSide?.hours) || "24",
    movePct: str(d.moveSide?.pct) || "2",
    legStop: str(e.legStop),
    takeProfitPct: pct(e.takeProfitOfCredit),
    takeTrailPct: str(e.takeTrailPct),
    trailRestPct: str(e.trailRestPct),
    ladder: (e.ladder ?? []).join(", "),
    lockAtPct: pct(e.lock?.at),
    lockFloorPct: pct(e.lock?.floor),
    exitHourUtc: str(e.exitHourUtc),
    buyBackBy: e.legBuyBackAt !== undefined ? "price" : e.legBuyBackShare !== undefined ? "share" : "none",
    buyBackValue: e.legBuyBackAt !== undefined ? String(e.legBuyBackAt) : pct(e.legBuyBackShare),
    btMean: str(b?.mean),
    btPer: b?.per ?? "day",
    btPositivePct: str(b?.positivePct),
    btWorst: str(b?.worst),
    btSamples: str(b?.samples),
    btBasis: b?.basis ?? "",
    audience: s.audience,
    userIds: [...s.userIds],
    planIds: [...s.planIds],
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
/** A typed number: "" is "not set"; anything that is not a number is NaN, which the schema refuses by name. */
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
const share = (v: string): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Number((n / 100).toFixed(8));
};
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const FIELD_NAMES: Record<string, string> = {
  lots: "Lots",
  toHourUtc: "The entry window",
  minDte: "Nearest expiry",
  maxDte: "Furthest expiry",
  legs: "What to trade",
  conditions: "Market conditions",
  moveSide: "One side after a move",
  exits: "When to exit",
  assets: "Coins",
  weekdayUtc: "The entry day",
  weekdays: "The entry days",
  oncePerExpiry: "One entry per expiry",
};
const EXIT_NAMES: Record<string, string> = {
  legStop: "The stop on each sold option",
  takeProfitOfCredit: "The profit take",
  takeTrailPct: "The trail from the profit take",
  trailRestPct: "The trail of the rest",
  ladder: "The steps",
  lock: "The profit lock",
  exitHourUtc: "The closing time",
  legBuyBackAt: "The buy-back",
  legBuyBackShare: "The buy-back",
};
/** Where an issue of the schema sits, as the editor names it: the exit, the leg, or the part of the form. */
function placeOf(path: readonly PropertyKey[]): string {
  const [head, next] = path;
  if (head === "exits" && typeof next === "string" && EXIT_NAMES[next]) return EXIT_NAMES[next];
  if (head === "legs" && typeof next === "number") return `Leg ${next + 1}`;
  return FIELD_NAMES[String(head)] ?? "The settings";
}
/** Every number the form holds, by the name on its label: a typed value that is not a number is said by that name. */
const typedNumbers = (f: SavedForm): [string, string][] => [
  ["Lots", f.lots],
  ["Nearest expiry", f.minDte],
  ["Furthest expiry", f.maxDte],
  ...f.legs.map((l, i): [string, string] => [`Leg ${i + 1}`, l.value]),
  ...(f.smaOn ? ([["The days of the average", f.smaDays]] as [string, string][]) : []),
  ...(f.ivOn ? ([["The lowest rank", f.ivMin], ["The highest rank", f.ivMax], ["The days of the rank", f.ivLookback]] as [string, string][]) : []),
  ...(f.moveOn ? ([["The move", f.movePct], ["The hours of the move", f.moveHours]] as [string, string][]) : []),
  ["The stop on each sold option", f.legStop],
  ["The profit take", f.takeProfitPct],
  ["The trail from the profit take", f.takeTrailPct],
  ["The trail of the rest", f.trailRestPct],
  ["The profit lock", f.lockAtPct],
  ["The profit lock's floor", f.lockFloorPct],
  ...(f.buyBackBy === "none" ? [] : ([["The buy-back", f.buyBackValue]] as [string, string][])),
  ...f.ladder.split(",").filter((x) => x.trim() !== "").map((x): [string, string] => ["The steps", x]),
];

/** The settings the form describes, or the first thing wrong with it in the admin's words. */
export function savedDefinitionOf(f: SavedForm): Parsed<SavedDefinition> {
  // the engine's day turns at 00:00 UTC, which is 05:30 in India: a window cannot cross it
  if (!f.anyTime && f.toHourUtc <= f.fromHourUtc) return { ok: false, error: "The entry window crosses 5:30 AM IST, where the engine's day turns. Choose a window that ends by 5:30 AM IST or starts after it." };
  if (!f.anyTime && f.toHourUtc - f.fromHourUtc > SAVED_LONG_WINDOW_HOURS && !f.oncePerExpiry) return { ok: false, error: "A window longer than six hours enters once per expiry: tick that box, or shorten the window." };
  if (f.anyTime && !f.oncePerExpiry) return { ok: false, error: "A strategy that may enter at any time of day enters once per expiry: tick that box." };
  const bad = typedNumbers(f).find(([, v]) => v.trim() !== "" && !Number.isFinite(Number(v)));
  if (bad) return { ok: false, error: `${bad[0]}: "${bad[1].trim()}" is not a number.` };
  // per cent on screen, a share in the settings: said in the unit the admin typed
  const take = num(f.takeProfitPct);
  if (take !== undefined && !(take > 0 && take < 100)) return { ok: false, error: "The profit take is between 0 and 100 % of the premium (100 % is never reached before settlement)." };
  const from = f.anyTime ? 0 : f.fromHourUtc;
  const ladder = f.ladder.trim() === "" ? undefined : f.ladder.split(",").map((x) => Number(x.trim()));
  const lockAt = share(f.lockAtPct);
  const lockFloor = share(f.lockFloorPct);
  if ((lockAt === undefined) !== (lockFloor === undefined)) return { ok: false, error: "A profit lock needs both its level and its floor." };
  const buyBack = num(f.buyBackValue);
  if (f.buyBackBy !== "none" && buyBack === undefined) return { ok: false, error: "The buy-back needs its level." };
  const raw = {
    assets: f.assets,
    venues: ["delta_india"],
    lots: num(f.lots),
    cadence: f.cadence,
    fromHourUtc: from,
    toHourUtc: f.anyTime ? 24 : f.toHourUtc,
    ...(f.cadence === "weekly" ? { weekdayUtc: utcWeekday(f.weekday, from) } : {}),
    ...(f.cadence === "daily" && f.weekdays.length > 0 ? { weekdays: f.weekdays.map((w) => utcWeekday(w, from)).sort((a, b) => a - b) } : {}),
    oncePerExpiry: f.oncePerExpiry,
    minDte: num(f.minDte),
    maxDte: num(f.maxDte),
    legs: f.legs.map((l) => ({ kind: l.kind, side: l.side, by: l.by, value: num(l.value) })),
    ...(f.smaOn || f.ivOn ? { conditions: drop({ sma: f.smaOn ? { days: num(f.smaDays), side: f.smaSide } : undefined, ivRank: f.ivOn ? drop({ min: num(f.ivMin), max: num(f.ivMax), lookbackDays: num(f.ivLookback) }) : undefined }) } : {}),
    ...(f.moveOn ? { moveSide: { hours: num(f.moveHours), pct: num(f.movePct) } } : {}),
    exits: drop({
      legStop: num(f.legStop),
      takeProfitOfCredit: share(f.takeProfitPct),
      takeTrailPct: num(f.takeTrailPct),
      trailRestPct: num(f.trailRestPct),
      ladder,
      lock: lockAt === undefined ? undefined : { at: lockAt, floor: lockFloor },
      exitHourUtc: num(f.exitHourUtc),
      legBuyBackAt: f.buyBackBy === "price" ? buyBack : undefined,
      legBuyBackShare: f.buyBackBy === "share" ? share(f.buyBackValue) : undefined,
    }),
  };
  const parsed = SavedDefinition.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]!;
  // the schema's own rules are written in plain words; a bare range or a missing value is said as that
  return { ok: false, error: `${placeOf(issue.path)}: ${issue.code === "custom" ? issue.message : "the value is missing or out of range."}` };
}

/** The backtest figures the form holds: null when none are typed, an error when some are and they do not make sense. */
export function savedBacktestOf(f: SavedForm): Parsed<SavedBacktest | null> {
  const typed = [f.btMean, f.btPositivePct, f.btWorst, f.btSamples, f.btBasis].some((v) => v.trim() !== "");
  if (!typed) return { ok: true, value: null };
  const parsed = SavedBacktest.safeParse({ mean: num(f.btMean), per: f.btPer, positivePct: num(f.btPositivePct), worst: num(f.btWorst), samples: num(f.btSamples), basis: f.btBasis });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Backtest figures: fill in the average, the share of winning trades, the worst trade, the number of trades and where the figures come from." };
}

/** Whether two sets of settings are the same, whatever the order of their keys. */
export function sameDefinition(a: SavedDefinition, b: SavedDefinition): boolean {
  const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));
  return stable(a) === stable(b);
}

/**
 * A built-in strategy as the editor's form (HC-TR-280): what "Copy as my own" opens, a new draft that leaves the
 * built-in one as it is. Only a strategy the editor can hold whole is copied: entered by the clock, on Delta Exchange
 * India, every leg an option out of the money. Anything else says why not, in the admin's words.
 */
/** The longest name a saved strategy may carry. */
export const SAVED_NAME_MAX = 60;
const SUMMARY_MAX = 300;
/** A sentence too long for the field, cut after its last whole sentence that fits. */
function wholeSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = text.slice(0, max).lastIndexOf(". ");
  return end > 0 ? text.slice(0, end + 1) : "";
}
export function savedFormFromBuiltIn(p: Playbook): { ok: true; form: SavedForm; notes: string[] } | { ok: false; why: string } {
  const c = p.clock;
  if (!c) return { ok: false, why: "It enters on a market condition, with exits the editor does not have yet." };
  if (!(c.venues.length === 1 && c.venues[0] === "delta_india")) return { ok: false, why: "It trades on another exchange than Delta Exchange India." };
  const legs: LegForm[] = [];
  for (const l of playbookTemplate(p)?.legs ?? []) {
    if (l.kind === "future") return { ok: false, why: "It holds a futures leg, which a saved strategy cannot." };
    if (l.lots !== undefined || l.expiryOffset !== undefined) return { ok: false, why: "Its legs differ in size or expiry, which the editor cannot hold." };
    // out of the money: a call above the spot, a put below it
    const up = l.kind === "call";
    if (l.premium !== undefined) legs.push({ kind: l.kind, side: l.side, by: "premium", value: String(l.premium) });
    else if (l.pct !== undefined && (up ? l.pct > 0 : l.pct < 0)) legs.push({ kind: l.kind, side: l.side, by: "pct", value: String(Math.abs(l.pct)) });
    else if (l.pct === undefined && (up ? l.k > 0 : l.k < 0)) legs.push({ kind: l.kind, side: l.side, by: "strikes", value: String(Math.abs(l.k)) });
    else return { ok: false, why: "It has a leg at or in the money, which the editor cannot hold yet." };
  }
  const anyTime = c.fromHourUtc === 0 && c.toHourUtc === 24;
  const cadence: SavedCadence = c.cadence === "monthly" ? "monthly" : c.weekdayUtc !== undefined ? "weekly" : "daily";
  // nothing is dropped without a word: a day the editor has no field for is a reason not to copy
  if (cadence === "monthly" && c.weekdayUtc !== undefined) return { ok: false, why: "It is monthly and tied to one weekday, which the editor cannot hold." };
  if (cadence !== "daily" && p.conditions?.weekdays !== undefined) return { ok: false, why: "It chooses its weekdays without being a daily strategy, which the editor cannot hold." };
  // a name is never cut: two built-in strategies must not end up with one copy name, so a long one is left for the admin to write
  const copyName = `${p.name} (copy)`;
  const name = copyName.length <= SAVED_NAME_MAX ? copyName : "";
  const summary = wholeSentences(p.summary, SUMMARY_MAX);
  const notes = [...(name === "" ? [`Its name is too long to copy (${SAVED_NAME_MAX} characters at most): give your strategy a name.`] : []), ...(summary !== p.summary ? ["Its description was too long to copy whole and was cut after a full sentence: read it and complete it."] : [])];
  const form: SavedForm = {
    ...emptySavedForm(),
    name,
    summary,
    assets: [...p.assets],
    lots: String(p.lots),
    cadence,
    anyTime,
    fromHourUtc: anyTime ? 16 : c.fromHourUtc,
    toHourUtc: anyTime ? 17 : c.toHourUtc,
    weekday: c.weekdayUtc === undefined ? 5 : istWeekday(c.weekdayUtc, anyTime ? 0 : c.fromHourUtc),
    weekdays: cadence === "daily" ? (p.conditions?.weekdays ?? []).map((w) => istWeekday(w, anyTime ? 0 : c.fromHourUtc)).sort((a, b) => a - b) : [],
    oncePerExpiry: Boolean(c.oncePerExpiry),
    minDte: String(p.minDte),
    maxDte: String(c.maxDte),
    legs,
    smaOn: p.conditions?.sma !== undefined,
    smaDays: str(p.conditions?.sma?.days) || "50",
    smaSide: p.conditions?.sma?.side ?? "above",
    ivOn: p.conditions?.ivRank !== undefined,
    ivMin: str(p.conditions?.ivRank?.min),
    ivMax: str(p.conditions?.ivRank?.max),
    ivLookback: str(p.conditions?.ivRank?.lookbackDays) || "90",
    moveOn: c.moveSide !== undefined,
    moveHours: str(c.moveSide?.hours) || "24",
    movePct: str(c.moveSide?.pct) || "2",
    legStop: str(c.legStop),
    takeProfitPct: pct(c.takeProfitOfCredit),
    takeTrailPct: str(c.takeTrailPct),
    trailRestPct: str(c.trailRestPct),
    ladder: (c.ladder ?? []).join(", "),
    lockAtPct: pct(c.lock?.at),
    lockFloorPct: pct(c.lock?.floor),
    exitHourUtc: str(c.exitHourUtc),
    buyBackBy: c.legBuyBackAt !== undefined ? "price" : c.legBuyBackShare !== undefined ? "share" : "none",
    buyBackValue: c.legBuyBackAt !== undefined ? String(c.legBuyBackAt) : pct(c.legBuyBackShare),
  };
  // the same rules a typed strategy meets: one the editor would refuse is not offered as a copy
  const held = savedDefinitionOf(form);
  return held.ok ? { ok: true, form, notes } : { ok: false, why: `The editor cannot hold it as it is. ${held.error}` };
}

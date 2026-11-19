"use client";
// Protect (ADR-059 §2.3; HC-TR-167, HC-TR-171): arm the exit rules of a strategy. A stop loss and a target on the
// strategy P&L, typed in money (the trader's currency, stored in USD) or as a percentage of the credit received, the
// debit paid or the max loss; a leg stop on one leg's mark (N × its entry, or a price) that exits that leg alone or
// the whole strategy; a spot level on the underlying; a time exit at an instant or at d days to expiry. When a level
// is crossed the API exits at market, short legs first, and says so in Telegram / mail; the card shows the fired
// state. The dialog is mounted once in the Workspace overlays and opens from the card, Details, the workbench and
// after a trade from the Builder.
// A target can trail instead of exiting (ADR-103; HC-TR-211): one more line in the Target box takes the give-back
// (money or a percentage of the best profit) and shows two worked exit levels; the card then reads "trailing" with
// the best and the exit level, and the fired chip says the target trailed.
// A leg stop has a third "What to exit" (ADR-104; HC-TR-213): this leg, then trail the rest. It takes a give-back
// (10 % of the best profit by default, or money) and says where the other legs would exit from where they stand now.
// Once such a stop has fired, the running trail shows as its own box: its give-back can be changed, unticking stops it.
import { type RuleBasis, type RuleChannel, type RuleKind, type RuleTrigger, type StrategyLeg, type StrategyRule, LEG_TRAIL_DEFAULT_PCT, RULE_BASIS_LABELS, RULE_KIND_LABELS, SETTLE_LEAD_MINUTES, isPositiveDecimal, nearestSettlement, restTrailFloorUsd, ruleLevel, ruleThresholdUsd, settleInstantMs, toDecimal, trailFloorUsd } from "@hapiecoin/schema";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { useClearRules, useSetRules, useStrategies } from "@/lib/api/strategies";
import { useTelegramStatus } from "@/lib/api/telegram";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { toPricingLegs } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { openLegs, serverLegToLocal } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { venueCalendar } from "@/lib/venue";

interface Draft {
  on: boolean;
  trigger: RuleTrigger;
  value: string;
  basis: RuleBasis;
}
/** The give-back of a trailing target (ADR-103): money in the trader's currency, or a percentage of the best profit. */
interface TrailDraft {
  on: boolean;
  trigger: "money" | "pct";
  value: string;
}
interface LegDraft {
  on: boolean;
  trigger: "multiple" | "price";
  value: string;
  /** What the fire exits: its leg, every leg, or its leg and then the rest on a trail (ADR-104). */
  exit: "leg" | "strategy" | "trail";
  /** The give-back of that trail: a percentage of the best profit of the rest, or money in the trader's currency. */
  give: { trigger: "money" | "pct"; value: string };
}
interface SpotDraft {
  on: boolean;
  trigger: "above" | "below";
  value: string;
}
interface TimeDraft {
  on: boolean;
  trigger: "at" | "dte" | "settle";
  /** For `at`: a datetime-local string (the trader's clock); for `dte`: whole days; for `settle`: whole minutes before the nearest settlement (ADR-097). */
  value: string;
}

/** The money the trader typed, in USD (INR converts at the stored rate). */
export function typedToUsd(value: string, money: MoneyFormat): number {
  const n = Number(value);
  return money.currency === "INR" ? n / (Number(money.rate) || 1) : n;
}
/** A stored USD amount back in the trader's currency, for the input box. */
export function usdToTyped(usd: string, money: MoneyFormat): string {
  return money.currency === "INR" ? toDecimal(Number(usd) * (Number(money.rate) || 1), 2) : usd;
}

const draftOf = (rule: StrategyRule | undefined, basis: RuleBasis, money: MoneyFormat): Draft => ({ on: rule !== undefined, trigger: rule?.trigger ?? "money", value: rule ? (rule.trigger === "money" ? usdToTyped(rule.value, money) : rule.value) : "", basis: rule?.basis ?? basis });
const trailDraftOf = (rule: StrategyRule | undefined, money: MoneyFormat): TrailDraft => ({ on: !!rule?.trail, trigger: rule?.trail?.trigger ?? "money", value: rule?.trail ? (rule.trail.trigger === "money" ? usdToTyped(rule.trail.value, money) : rule.trail.value) : "" });
const legDraftOf = (rule: StrategyRule | undefined, money: MoneyFormat): LegDraft => ({
  on: rule !== undefined,
  trigger: rule?.trigger === "price" ? "price" : "multiple",
  value: rule?.value ?? "",
  exit: rule?.scope === "strategy" ? "strategy" : rule?.trail ? "trail" : "leg",
  give: rule?.trail && rule.scope !== "strategy" ? { trigger: rule.trail.trigger, value: rule.trail.trigger === "money" ? usdToTyped(rule.trail.value, money) : rule.trail.value } : { trigger: "pct", value: LEG_TRAIL_DEFAULT_PCT },
});
/** The give-back of a running trail on the rest (its own trigger and value), for the box that edits it. */
const restDraftOf = (rule: StrategyRule | undefined, money: MoneyFormat): TrailDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "pct" ? "pct" : "money", value: rule ? (rule.trigger === "pct" ? rule.value : usdToTyped(rule.value, money)) : "" });
/** A typed give-back as the API takes it (money in USD), or null when it is nothing, or a percentage that is everything. */
const giveBackOf = (trigger: "money" | "pct", typed: string, money: MoneyFormat): { trigger: "money" | "pct"; value: string } | null => {
  const value = trigger === "money" ? toDecimal(typedToUsd(typed, money), 2) : typed;
  return isPositiveDecimal(value) && !(trigger === "pct" && Number(value) >= 100) ? { trigger, value } : null;
};
const spotDraftOf = (rule: StrategyRule | undefined): SpotDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "above" ? "above" : "below", value: rule?.value ?? "" });
const timeDraftOf = (rule: StrategyRule | undefined): TimeDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "dte" ? "dte" : rule?.trigger === "settle" ? "settle" : "at", value: rule ? (rule.trigger === "at" ? toLocalInput(rule.value) : rule.value) : "" });

/** "2026-09-12T17:00" in the trader's clock for a datetime-local box, from an ISO instant. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** The instant a datetime-local box holds, as ISO; null when empty or impossible. */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const fmtInstant = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** "−₹5,000 (−$60)" style: the level in the trader's currency, USD beside it when the currency is not USD. */
export function levelText(usd: number, money: MoneyFormat): string {
  const main = fmtMoney(usd, money, { signed: true });
  return money.currency === "USD" ? main : `${main} (${fmtMoney(usd, USD, { signed: true })})`;
}

/** "S P 78,000 25 Sep" for a leg a rule names. */
export function legTag(l: Pick<StrategyLeg, "side" | "kind" | "strike" | "expiry">): string {
  return `${l.side === "sell" ? "S" : "B"} ${l.kind === "future" ? "FUT" : `${l.kind === "call" ? "C" : "P"} ${fmtStrike(l.strike)}`} ${fmtExpiry(l.expiry)}`;
}

/** "₹300" or "25 %": the give-back of a trailing target. */
const giveBackText = (trail: NonNullable<StrategyRule["trail"]>, money: MoneyFormat) => (trail.trigger === "money" ? fmtMoney(Number(trail.value), money) : `${trail.value} %`);

/** One rule's level as the card and Details show it, whatever its kind. */
export function ruleText(r: StrategyRule, money: MoneyFormat, legs: readonly StrategyLeg[] = []): string {
  if (r.kind === "target" && r.trail) {
    // past the target and still armed: the level that matters now is the exit under the best, not the target
    if (r.state === "armed" && typeof r.peakPnl === "string") return `trailing: best ${fmtMoney(Number(r.peakPnl), money, { signed: true })}, exits at ${fmtMoney(trailFloorUsd(Number(r.peakPnl), r.trail), money, { signed: true })}`;
    return `target at ${levelText(Number(r.thresholdUsd), money)}${r.trigger === "pct" ? ` (${r.value} %)` : ""}, then trail ${giveBackText(r.trail, money)}${typeof r.peakPnl === "string" ? `, best ${fmtMoney(Number(r.peakPnl), money, { signed: true })}` : ""}`;
  }
  if (r.kind === "trail") {
    // armed by the engine when a leg stop set to trail the rest fired (ADR-104): its figures are where the legs still
    // open stand (their own profit, without the stopped leg's result), not the strategy total
    const give = { trigger: r.trigger === "pct" ? ("pct" as const) : ("money" as const), value: r.value };
    if (r.state === "armed" && typeof r.peakPnl === "string") return `trailing the rest: best ${fmtMoney(Number(r.peakPnl), money, { signed: true })}, exits at ${fmtMoney(restTrailFloorUsd(Number(r.peakPnl), give), money, { signed: true })}`;
    return `trailing the rest: exits on a fall of ${giveBackText(give, money)} from its best`;
  }
  if (r.kind === "stop" || r.kind === "target") return `${r.kind} at ${levelText(Number(r.thresholdUsd), money)}${r.trigger === "pct" ? ` (${r.value} %)` : ""}`;
  if (r.kind === "leg_stop") {
    const leg = legs.find((l) => l.id === r.legId);
    return `${leg ? legTag(leg) : "leg"} stop at ${fmtPrice(r.thresholdUsd)}${r.trigger === "multiple" ? ` (${r.value}× entry)` : ""}${r.scope === "strategy" ? ", exits all" : r.trail ? `, then trail the rest by ${giveBackText(r.trail, money)}` : ""}`;
  }
  if (r.kind === "spot") return `spot ${r.trigger === "above" ? "≥" : "≤"} ${fmtPrice(r.thresholdUsd, 0)}`;
  if (r.trigger === "settle") return `exit all legs ${r.value} min before expiry settles (${fmtInstant(new Date(Number(r.thresholdUsd)).toISOString())})`;
  return r.trigger === "at" ? `exit at ${fmtInstant(r.value)}` : `exit at ${r.value} ${r.value === "1" ? "day" : "days"} to expiry`;
}

/** The armed rules of a strategy, one line for the card and the Details dialog: "stop at −₹5,000 · target at +₹4,200". */
export function rulesLine(rules: readonly StrategyRule[] | undefined, money: MoneyFormat, legs: readonly StrategyLeg[] = []): string | null {
  const armed = (rules ?? []).filter((r) => r.state === "armed");
  if (!armed.length) return null;
  return armed.map((r) => ruleText(r, money, legs)).join(" · ");
}

/** The most recent fired rule, for the card's chip. */
export function firedRule(rules: readonly StrategyRule[] | undefined): StrategyRule | null {
  const fired = (rules ?? []).filter((r) => r.state === "fired").sort((a, b) => (b.firedAt ?? "").localeCompare(a.firedAt ?? ""));
  return fired[0] ?? null;
}
/** The card chip's words for a fired rule. */
export const FIRED_LABELS: Record<RuleKind, string> = { stop: "stop fired", target: "target hit", leg_stop: "leg stop fired", spot: "spot level fired", time: "time exit fired", trail: "trail on the rest fired" };
/** The chip for one fired rule: a target that trailed says how far the profit ran before the exit. */
export function firedLabel(r: StrategyRule, money: MoneyFormat): string {
  return r.kind === "target" && r.trail && typeof r.peakPnl === "string" ? `${FIRED_LABELS.target} · trailed from ${fmtMoney(Number(r.peakPnl), money, { signed: true })}` : FIRED_LABELS[r.kind];
}

export function RuleDialog({ book }: { book: PaperBook }) {
  const target = useUiStore((s) => s.rulesFor);
  const closeRules = useUiStore((s) => s.closeRules);
  const protectPrompt = useUiStore((s) => s.protectPrompt);
  const setProtectPrompt = useUiStore((s) => s.setProtectPrompt);
  const { data } = useStrategies();
  const s = target ? (data ?? []).find((x) => x.id === target.strategyId) ?? null : null;
  const setRules = useSetRules();
  const clear = useClearRules();
  const telegram = useTelegramStatus(target !== null);
  const money = book.money;
  // only legs that are actually held count, as the engine values them (a resting or refused live entry is not a position)
  const open = s ? openLegs(s).filter((l) => l.entryPrice !== null) : [];
  const lotSize = s ? book.lotSizeOf(s.asset, s.venue) : "0";
  // the bases: credit received / debit paid from the entry premiums; max loss from the pricing engine at the nearest expiry
  const netPremiumUsd = useMemo(() => open.reduce((sum, l) => sum + (l.side === "sell" ? 1 : -1) * Number(l.entryPrice ?? l.price) * l.lots * Number(lotSize), 0), [open, lotSize]);
  const pricingLegs = useMemo(() => (s ? toPricingLegs(open.map((l) => serverLegToLocal(l, s.asset)), lotSize, { spot: undefined }) : []), [s, open, lotSize]);
  const spot = s ? book.spotOf(s.asset, s.venue) : null;
  const analysis = useAnalysis(pricingLegs, s && spot !== null && pricingLegs.length ? { spot, nowMs: Date.now(), calendar: venueCalendar(s.asset, s.venue), defaultIv: 0.5 } : null);
  const maxLossUsd = analysis.result && Number.isFinite(analysis.result.maxLoss) && analysis.result.maxLoss < 0 ? -analysis.result.maxLoss : null;
  const defaultBasis: RuleBasis = netPremiumUsd > 0 ? "credit" : netPremiumUsd < 0 ? "debit" : "max_loss";
  const basisUsd = (b: RuleBasis): number | null => (b === "credit" ? (netPremiumUsd > 0 ? netPremiumUsd : null) : b === "debit" ? (netPremiumUsd < 0 ? -netPremiumUsd : null) : maxLossUsd);
  const [stop, setStop] = useState<Draft>(draftOf(undefined, "credit", money));
  const [tgt, setTgt] = useState<Draft>(draftOf(undefined, "credit", money));
  const [trail, setTrail] = useState<TrailDraft>(trailDraftOf(undefined, money));
  const [legStops, setLegStops] = useState<Record<string, LegDraft>>({});
  const [rest, setRest] = useState<TrailDraft>(restDraftOf(undefined, money));
  const [spotD, setSpotD] = useState<SpotDraft>(spotDraftOf(undefined));
  const [timeD, setTimeD] = useState<TimeDraft>(timeDraftOf(undefined));
  const [channels, setChannels] = useState<RuleChannel[]>(["push"]);
  // seed once per strategy opened: the list refreshes on every poll and must not wipe what is being typed
  const openedFor = target?.strategyId ?? null;
  const seedFor = s?.id ?? null; // the list may not hold the strategy yet right after a trade: seed once it does
  useEffect(() => {
    if (!openedFor || !s || s.id !== openedFor) return;
    const armed = (s.rules ?? []).filter((r) => r.state === "armed");
    const st = armed.find((r) => r.kind === "stop");
    const tg = armed.find((r) => r.kind === "target");
    setStop(draftOf(st, defaultBasis, money));
    setTgt(draftOf(tg, defaultBasis, money));
    setTrail(trailDraftOf(tg, money));
    setLegStops(Object.fromEntries(openLegs(s).map((l) => [l.id, legDraftOf(armed.find((r) => r.kind === "leg_stop" && r.legId === l.id), money)])));
    setRest(restDraftOf(armed.find((r) => r.kind === "trail"), money));
    setSpotD(spotDraftOf(armed.find((r) => r.kind === "spot")));
    setTimeD(timeDraftOf(armed.find((r) => r.kind === "time")));
    setChannels(armed[0]?.channels ?? ["push"]);
    // the drafts are seeded from the strategy as it was when the dialog opened (openedFor and the strategy's arrival only, on purpose)
  }, [openedFor, seedFor]);
  // a trail that starts while the dialog is open (its leg stop fired meanwhile) arrives ticked with its own give-back:
  // an unticked box would remove it on the next Arm
  const restId = (s?.rules ?? []).find((r) => r.kind === "trail" && r.state === "armed")?.id ?? null;
  useEffect(() => {
    if (s) setRest(restDraftOf((s.rules ?? []).find((r) => r.kind === "trail" && r.state === "armed"), money));
    // seeded when a running trail appears, changes or goes (restId only, on purpose)
  }, [restId]);
  if (!s || !target) return null;
  const toBody = (kind: RuleKind, d: Draft) => {
    if (!d.on) return null;
    if (d.trigger === "money") return isPositiveDecimal(toDecimal(typedToUsd(d.value, money), 2)) ? { kind, trigger: "money" as const, value: toDecimal(typedToUsd(d.value, money), 2), channels } : "invalid";
    const b = basisUsd(d.basis);
    if (b === null) return "no-basis";
    return isPositiveDecimal(d.value) && Number(d.value) <= 1000 ? { kind, trigger: "pct" as const, value: d.value, basis: d.basis, basisUsd: toDecimal(b, 2), channels } : "invalid";
  };
  const stopBody = toBody("stop", stop);
  const tgtFixed = toBody("target", tgt);
  // the give-back of a trailing target, in USD for money; it must leave the exit level a profit from the first tick
  const trailValue = trail.trigger === "money" ? toDecimal(typedToUsd(trail.value, money), 2) : trail.value;
  const trailOn = trail.on && tgtFixed !== null && typeof tgtFixed !== "string";
  const tgtUsd = trailOn ? Number(ruleThresholdUsd(tgtFixed)) : null;
  const trailShape = !trailOn ? null : !isPositiveDecimal(trailValue) || (trail.trigger === "pct" && Number(trailValue) >= 100) ? ("invalid-trail" as const) : trail.trigger === "money" && Number(trailValue) >= Number(ruleThresholdUsd(tgtFixed)) ? ("trail-big" as const) : null;
  // where the trail would stand the moment it is armed: a trail already running hands its best to the new rule unless
  // the target is raised above it (the server does the same); otherwise today's P&L, when it is already past the target
  const running = (s.rules ?? []).find((r) => r.kind === "target" && r.state === "armed" && r.trail && typeof r.peakPnl === "string");
  const bestSoFar = running ? Number(running.peakPnl) : null;
  const pnlNow = open.length && open.every((l) => book.priceOf(s, l) !== null) ? book.pnlOf(s).total : null;
  const floorAt = (peak: number) => trailFloorUsd(peak, { trigger: trail.trigger, value: trailValue });
  const keptBest = tgtUsd !== null && trailShape === null && bestSoFar !== null && bestSoFar >= tgtUsd ? bestSoFar : null;
  // an exit level the P&L is already at or under would fire on the next tick, like any other level
  const trailProblem = trailShape ?? (keptBest !== null && pnlNow !== null && pnlNow <= floorAt(keptBest) ? ("crossed" as const) : null);
  const tgtBody = trailOn ? (trailProblem ?? { ...tgtFixed, trail: { trigger: trail.trigger, value: trailValue } }) : tgtFixed;
  // the dte the engine counts: the nearest settlement of the dated legs (options and dated futures), fractional days
  const nearest = s ? nearestSettlement(open, s.asset) : null;
  const dteNow = nearest ? Math.max(0, Math.round(((nearest.ms - Date.now()) / 86_400_000) * 10) / 10) : null;
  // a level the market is already past would fire on the next tick: refused here, where the mark, the spot and the days are known
  const legBodies = open.map((l) => {
    const d = legStops[l.id];
    if (!d?.on) return null;
    if (!isPositiveDecimal(d.value)) return "invalid";
    const level = Number(ruleLevel({ kind: "leg_stop", trigger: d.trigger, value: d.value, basisUsd: undefined }, l.entryPrice));
    if (level <= 0) return "invalid";
    const mark = book.priceOf(s, l);
    if (mark !== null && (l.side === "sell" ? mark >= level : mark <= level)) return "crossed";
    if (d.exit !== "trail") return { kind: "leg_stop" as const, trigger: d.trigger, value: d.value, legId: l.id, scope: d.exit, channels };
    const give = giveBackOf(d.give.trigger, d.give.value, money);
    return give ? { kind: "leg_stop" as const, trigger: d.trigger, value: d.value, legId: l.id, scope: "leg" as const, trail: give, channels } : "invalid-trail";
  });
  // the trail a fired leg stop started: kept with its give-back as typed, or left out of the set (which stops it)
  const restRule = (s.rules ?? []).find((r) => r.kind === "trail" && r.state === "armed");
  const restGive = giveBackOf(rest.trigger, rest.value, money);
  const restChanged = !!restRule && !!restGive && (restGive.trigger !== (restRule.trigger === "pct" ? "pct" : "money") || restGive.value !== restRule.value);
  const restBody = !restRule || !rest.on ? null : restGive ? { kind: "trail" as const, trigger: restGive.trigger, value: restGive.value, channels } : "invalid-trail";
  const spotBody = !spotD.on ? null : !isPositiveDecimal(spotD.value) ? "invalid" : spot !== null && (spotD.trigger === "above" ? spot >= Number(spotD.value) : spot <= Number(spotD.value)) ? "crossed" : { kind: "spot" as const, trigger: spotD.trigger, value: spotD.value, channels };
  const timeIso = timeD.trigger === "at" ? fromLocalInput(timeD.value) : null;
  // a settle rule's instant: the nearest settlement less the minutes, fixed when armed (the server computes the same)
  const settleMinutesOk = /^\d{1,3}$/.test(timeD.value) && Number(timeD.value) >= SETTLE_LEAD_MINUTES.min && Number(timeD.value) <= SETTLE_LEAD_MINUTES.max;
  const settleMs = timeD.trigger === "settle" && settleMinutesOk ? settleInstantMs(timeD.value, nearest?.ms ?? null) : null;
  const timeBody = !timeD.on
    ? null
    : timeD.trigger === "at"
      ? timeIso
        ? Date.parse(timeIso) > Date.now()
          ? { kind: "time" as const, trigger: "at" as const, value: timeIso, channels }
          : "past"
        : "invalid"
      : timeD.trigger === "settle"
        ? nearest === null
          ? "no-leg"
          : !settleMinutesOk
            ? "invalid"
            : settleMs !== null && settleMs <= Date.now()
            ? "past"
            : { kind: "time" as const, trigger: "settle" as const, value: timeD.value, channels }
        : !/^\d{1,3}$/.test(timeD.value)
          ? "invalid"
          : dteNow !== null && dteNow <= Number(timeD.value)
            ? "crossed"
            : { kind: "time" as const, trigger: "dte" as const, value: timeD.value, channels };
  const all = [stopBody, tgtBody, ...legBodies, restBody, spotBody, timeBody];
  const problem = all.includes("invalid") ? "Enter a level greater than 0" : all.includes("invalid-trail") ? "Enter a give-back greater than 0 (a percentage below 100)" : all.includes("trail-big") ? "The give-back must be below the target, so the exit level is always a profit" : all.includes("no-basis") ? "That basis is not known for this strategy · use money" : all.includes("no-leg") ? "No dated leg to count to" : all.includes("past") ? "The exit time has already passed" : all.includes("crossed") ? "That level is already crossed · it would fire on the next tick" : null;
  const bodies = all.filter((b): b is Exclude<typeof b, string | null> => b !== null && typeof b !== "string");
  const levelOf = (d: Draft, kind: RuleKind): number | null => {
    const b = toBody(kind, d);
    return b && typeof b !== "string" ? Number(ruleThresholdUsd(b)) : null;
  };
  const stopLevel = levelOf(stop, "stop");
  const tgtLevel = levelOf(tgt, "target");
  const armedNow = (s.rules ?? []).some((r) => r.state === "armed");
  const legsWord = `${open.length} open ${open.length === 1 ? "leg" : "legs"}`;
  const busy = setRules.isPending || clear.isPending;
  const kinds = [...new Set(bodies.map((b) => b.kind))];
  const arm = () => {
    if (problem) return toast.error("Check the levels", { description: problem });
    setRules.mutate(
      { id: s.id, body: { rules: bodies } },
      {
        onSuccess: () => {
          toast(bodies.length ? "Protected" : "Rules removed", { description: bodies.length ? `${s.name} · ${kinds.map((k) => RULE_KIND_LABELS[k].toLowerCase()).join(" and ")} armed · checked every few seconds by the server` : s.name });
          closeRules();
        },
        onError: (e) => toast.error("Could not arm", { description: e.message }),
      },
    );
  };
  const unit = <T extends string>(id: string, value: T, options: { key: T; label: string; title?: string }[], onPick: (t: T) => void, label = "Unit") => (
    <div className="flex overflow-hidden rounded border border-border" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onPick(o.key)} className={cn("px-2 py-1", value === o.key ? "bg-muted text-foreground" : "text-muted-foreground")} aria-pressed={value === o.key} title={o.title} data-testid={`${id}-${o.key}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
  const box = (id: string, on: boolean, setOn: (v: boolean) => void, title: string, hint: string, body: React.ReactNode) => (
    <div className={cn("rounded border p-2", on ? "border-border" : "border-border/50")} data-testid={id} data-on={on}>
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox checked={on} onCheckedChange={(v) => setOn(v === true)} data-testid={`${id}-on`} />
        {title}
        <span className="micro ml-auto">{hint}</span>
      </label>
      {on ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{body}</div> : null}
    </div>
  );
  const field = (kind: RuleKind, d: Draft, set: (d: Draft) => void, level: number | null, extra: React.ReactNode = null, hint = kind === "stop" ? "exit all when P&L falls to" : "exit all when P&L reaches") =>
    box(
      `rule-${kind}`,
      d.on,
      (on) => set({ ...d, on }),
      RULE_KIND_LABELS[kind],
      hint,
      <>
        {unit(`rule-${kind}`, d.trigger, [{ key: "money" as const, label: money.currency === "INR" ? "₹" : "$" }, { key: "pct" as const, label: "%" }], (t) => set({ ...d, trigger: t }))}
        <input type="number" min={0} step="any" value={d.value} onChange={(e) => set({ ...d, value: e.target.value })} className="h-7 w-28 rounded border border-input bg-background px-2 text-right text-xs" aria-label={`${RULE_KIND_LABELS[kind]} level`} data-testid={`rule-${kind}-value`} />
        {d.trigger === "pct" ? (
          <select value={d.basis} onChange={(e) => set({ ...d, basis: e.target.value as RuleBasis })} className="h-7 rounded border border-input bg-background px-1 text-xs" aria-label="Percentage of" data-testid={`rule-${kind}-basis`}>
            {(["credit", "debit", "max_loss"] as const).map((b) => (
              <option key={b} value={b} disabled={basisUsd(b) === null}>
                {RULE_BASIS_LABELS[b]}
                {basisUsd(b) !== null ? ` (${fmtMoney(basisUsd(b)!, money)})` : " (not known)"}
              </option>
            ))}
          </select>
        ) : null}
        <span className="num text-muted-foreground" data-testid={`rule-${kind}-level`}>{level !== null ? `= ${levelText(level, money)}` : "—"}</span>
        {extra}
      </>,
    );
  // the trail line of the Target box: off by default, one number when on, and two worked exit levels so "below its
  // best" is never read as "below the target"
  const signed = (usd: number) => fmtMoney(usd, money, { signed: true });
  const trailWords = (level: number) =>
    keptBest !== null
      ? `Already trailing: the best so far is ${signed(keptBest)}, so the exit is ${signed(floorAt(keptBest))} from the moment you arm. It never moves down.`
      : `${bestSoFar !== null ? `The target is above the best so far (${signed(bestSoFar)}), so the trail starts over. ` : ""}${
          pnlNow !== null && pnlNow >= level
            ? `P&L is already ${signed(pnlNow)}: the trail starts as soon as you arm, with the exit at ${signed(floorAt(pnlNow))}. The exit never moves down.`
            : `Nothing happens below ${signed(level)}. At ${signed(level)} the exit is set at ${signed(floorAt(level))}. If the profit reaches ${signed(level * 2)} the exit moves up to ${signed(floorAt(level * 2))}. The exit never moves down.`
        }`;
  const trailField = (
    <div className="flex basis-full flex-col gap-1 border-t border-border/50 pt-2" data-testid="rule-target-trail" data-on={trail.on}>
      <label className="flex items-center gap-2">
        <Checkbox checked={trail.on} onCheckedChange={(v) => setTrail({ ...trail, on: v === true })} data-testid="rule-target-trail-on" />
        Trail instead of exiting at the target
        <span className="micro ml-auto">let the profit run · exit when it falls back</span>
      </label>
      {trail.on ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">exit all when the profit falls by</span>
            {unit("rule-target-trail", trail.trigger, [{ key: "money" as const, label: money.currency === "INR" ? "₹" : "$" }, { key: "pct" as const, label: "%", title: "A percentage of the best profit" }], (t) => setTrail({ ...trail, trigger: t }), "Give-back unit")}
            <input type="number" min={0} step="any" value={trail.value} onChange={(e) => setTrail({ ...trail, value: e.target.value })} className="h-7 w-24 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Give-back from the best profit" data-testid="rule-target-trail-value" />
            <span className="text-muted-foreground">from its best</span>
          </div>
          <p className="text-2xs text-muted-foreground" data-testid="rule-target-trail-preview">
            {tgtUsd !== null && trailShape === null ? trailWords(tgtUsd) : "Enter the target and the give-back to see the exit level."}
          </p>
        </>
      ) : null}
    </div>
  );
  const legField = (l: StrategyLeg) => {
    const d = legStops[l.id] ?? legDraftOf(undefined, money);
    // what the other held legs stand at now, in USD: the trail would start from there if this stop fired this moment
    const others = open.filter((o) => o.id !== l.id);
    const restNow = others.length && others.every((o) => book.priceOf(s, o) !== null) ? others.reduce((sum, o) => sum + (book.priceOf(s, o)! - Number(o.entryPrice)) * o.lots * Number(lotSize) * (o.side === "buy" ? 1 : -1), 0) : null;
    const give = giveBackOf(d.give.trigger, d.give.value, money);
    const restWords = !give
      ? "Enter a give-back greater than 0 (a percentage below 100)."
      : restNow === null
        ? "When this stop fires the other legs stay open, and exit together once their profit falls this far from its best."
        : give.trigger === "pct" && restNow <= 0
          ? `The other legs are ${signed(restNow)} now. A percentage waits until they are in profit; from then the exit follows their best profit up and never moves down.`
          : `The other legs are ${signed(restNow)} now. If they stand there when this stop fires, they exit together at ${signed(restTrailFloorUsd(restNow, give))}. The exit follows their best profit up and never moves down; their own stops stay armed.`;
    const set = (n: LegDraft) => setLegStops((m) => ({ ...m, [l.id]: n }));
    const id = `rule-leg-${l.id}`;
    const level = isPositiveDecimal(d.value) ? ruleLevel({ kind: "leg_stop", trigger: d.trigger, value: d.value, basisUsd: undefined }, l.entryPrice) : null;
    const mark = book.priceOf(s, l);
    return (
      <div key={l.id}>
        {box(
          id,
          d.on,
          (on) => set({ ...d, on }),
          `${legTag(l)} · ${l.lots} lots`,
          l.side === "sell" ? `entry ${fmtPrice(l.entryPrice ?? l.price)} · exit when its mark rises to` : `entry ${fmtPrice(l.entryPrice ?? l.price)} · exit when its mark falls to`,
          <>
            {unit(id, d.trigger, [{ key: "multiple" as const, label: "× entry", title: "A multiple of the entry price" }, { key: "price" as const, label: "price", title: "A mark price" }], (t) => set({ ...d, trigger: t }))}
            <input type="number" min={0} step="any" value={d.value} onChange={(e) => set({ ...d, value: e.target.value })} className="h-7 w-24 rounded border border-input bg-background px-2 text-right text-xs" aria-label={`${legTag(l)} stop level`} data-testid={`${id}-value`} />
            <span className="num text-muted-foreground" data-testid={`${id}-level`}>{level !== null ? `= ${fmtPrice(level)}${mark !== null ? ` · now ${fmtPrice(mark)}` : ""}` : "—"}</span>
            <select value={d.exit} onChange={(e) => set({ ...d, exit: e.target.value as LegDraft["exit"] })} className="ml-auto h-7 rounded border border-input bg-background px-1 text-xs" aria-label="What to exit" data-testid={`${id}-scope`}>
              <option value="leg">exit this leg only</option>
              <option value="strategy">exit the whole strategy</option>
              <option value="trail" disabled={others.length === 0}>exit this leg, then trail the rest</option>
            </select>
            {d.exit === "trail" ? (
              <div className="flex basis-full flex-col gap-1 border-t border-border/50 pt-2" data-testid={`${id}-trail`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">then exit the rest when their profit falls by</span>
                  {unit(`${id}-trail`, d.give.trigger, [{ key: "pct" as const, label: "%", title: "A percentage of the best profit of the other legs" }, { key: "money" as const, label: money.currency === "INR" ? "₹" : "$" }], (t) => set({ ...d, give: { trigger: t, value: t === "pct" ? LEG_TRAIL_DEFAULT_PCT : "" } }), "Give-back unit")}
                  <input type="number" min={0} step="any" value={d.give.value} onChange={(e) => set({ ...d, give: { ...d.give, value: e.target.value } })} className="h-7 w-24 rounded border border-input bg-background px-2 text-right text-xs" aria-label={`${legTag(l)} give-back for the rest`} data-testid={`${id}-trail-value`} />
                  <span className="text-muted-foreground">from its best</span>
                </div>
                <p className="text-2xs text-muted-foreground" data-testid={`${id}-trail-preview`}>{restWords}</p>
              </div>
            ) : null}
          </>,
        )}
      </div>
    );
  };
  const restField = restRule
    ? box(
        "rule-trail",
        rest.on,
        (on) => setRest({ ...rest, on }),
        RULE_KIND_LABELS.trail,
        "started by a leg stop · untick to stop trailing",
        <>
          <span className="text-muted-foreground">exit all when the profit of the rest falls by</span>
          {unit("rule-trail", rest.trigger, [{ key: "pct" as const, label: "%", title: "A percentage of the best profit of the legs still open" }, { key: "money" as const, label: money.currency === "INR" ? "₹" : "$" }], (t) => setRest({ ...rest, trigger: t }), "Give-back unit")}
          <input type="number" min={0} step="any" value={rest.value} onChange={(e) => setRest({ ...rest, value: e.target.value })} className="h-7 w-24 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Give-back for the rest" data-testid="rule-trail-value" />
          <span className="text-muted-foreground">from its best</span>
          <span className="num basis-full text-muted-foreground" data-testid="rule-trail-level">{restChanged ? "A changed give-back starts the trail again from where the rest stands when you arm; the exit then follows the best from there." : ruleText(restRule, money, s.legs)}</span>
        </>,
      )
    : null;
  const spotField = box(
    "rule-spot",
    spotD.on,
    (on) => setSpotD({ ...spotD, on }),
    RULE_KIND_LABELS.spot,
    `exit all when ${s.asset} spot is`,
    <>
      {unit("rule-spot", spotD.trigger, [{ key: "below" as const, label: "at or below" }, { key: "above" as const, label: "at or above" }], (t) => setSpotD({ ...spotD, trigger: t }), "Direction")}
      <input type="number" min={0} step="any" value={spotD.value} onChange={(e) => setSpotD({ ...spotD, value: e.target.value })} className="h-7 w-28 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Spot level" data-testid="rule-spot-value" />
      <span className="num text-muted-foreground" data-testid="rule-spot-level">{spot !== null ? `now ${fmtPrice(spot, 0)}` : "spot not known yet"}</span>
    </>,
  );
  const timeField = box(
    "rule-time",
    timeD.on,
    (on) => setTimeD({ ...timeD, on }),
    RULE_KIND_LABELS.time,
    "exit all",
    <>
      {unit(
        "rule-time",
        timeD.trigger,
        [
          { key: "at" as const, label: "at a time" },
          { key: "dte" as const, label: "days before expiry", title: nearest ? `Nearest expiry ${fmtExpiry(nearest.expiry)}` : "No dated leg" },
          { key: "settle" as const, label: "before expiry settles", title: nearest ? `Every leg closes shortly before ${fmtExpiry(nearest.expiry)} settles, so a calendar never leaves its far leg open` : "No dated leg" },
        ],
        (t) => setTimeD({ ...timeD, trigger: t, value: t === "settle" ? String(SETTLE_LEAD_MINUTES.default) : "" }),
        "When",
      )}
      {timeD.trigger === "at" ? (
        <input type="datetime-local" value={timeD.value} onChange={(e) => setTimeD({ ...timeD, value: e.target.value })} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Exit time" data-testid="rule-time-value" />
      ) : timeD.trigger === "settle" ? (
        <>
          <input type="number" min={SETTLE_LEAD_MINUTES.min} max={SETTLE_LEAD_MINUTES.max} step={1} value={timeD.value} onChange={(e) => setTimeD({ ...timeD, value: e.target.value })} className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Minutes before settlement" data-testid="rule-time-value" disabled={!nearest} />
          <span className="text-muted-foreground">min before</span>
        </>
      ) : (
        <input type="number" min={0} max={999} step={1} value={timeD.value} onChange={(e) => setTimeD({ ...timeD, value: e.target.value })} className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Days to expiry" data-testid="rule-time-value" disabled={!nearest} />
      )}
      <span className="num text-muted-foreground" data-testid="rule-time-level">
        {timeD.trigger === "at"
          ? timeIso
            ? `= ${fmtInstant(timeIso)} your clock`
            : "—"
          : timeD.trigger === "settle"
            ? nearest
              ? settleMs !== null
                ? `${fmtExpiry(nearest.expiry)} settles · exit all legs at ${fmtInstant(new Date(settleMs).toISOString())} your clock`
                : `${fmtExpiry(nearest.expiry)} settles · ${SETTLE_LEAD_MINUTES.min} to ${SETTLE_LEAD_MINUTES.max} minutes`
              : "no dated leg to count to"
            : nearest
              ? `nearest expiry ${fmtExpiry(nearest.expiry)} · ${dteNow} days now`
              : "no dated leg to count to"}
      </span>
    </>,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && closeRules()}>
      <DialogContent className="sm:max-w-[640px]" data-testid="rule-dialog" data-after-trade={target.afterTrade}>
        <DialogHeader>
          <DialogTitle>Protect {s.name}</DialogTitle>
          <DialogDescription>
            {s.status === "live" ? "HapieCoin sends exit orders" : "HapieCoin closes the paper legs"} when a level is crossed: all {legsWord} (a leg stop can take its leg alone), short legs first, market at the mark of that moment, this strategy's lots only. The server checks every few seconds; a fired rule never re-arms.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            {field("stop", stop, setStop, stopLevel)}
            {field("target", tgt, setTgt, tgtLevel, trailField, trail.on ? "start trailing when P&L reaches" : undefined)}
            {open.length ? (
              <>
                <div className="micro mt-1">Leg stops</div>
                {open.map(legField)}
              </>
            ) : null}
            {restField}
            <div className="micro mt-1">Market and time</div>
            {spotField}
            {timeField}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-2xs" data-testid="rule-channels">
            <span className="micro">Tell me by</span>
            <span className="text-muted-foreground">the card (always)</span>
            {(["email", "telegram"] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-1">
                <Checkbox checked={channels.includes(ch)} disabled={ch === "telegram" && telegram.data?.linked !== true} onCheckedChange={(v) => setChannels((c) => (v === true ? [...new Set([...c, ch])] : c.filter((x) => x !== ch)))} data-testid={`rule-channel-${ch}`} />
                {ch === "email" ? "email" : telegram.data?.linked ? "Telegram" : "Telegram (link it in Alerts)"}
              </label>
            ))}
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            {s.status === "live" ? "A refused exit is retried three times; a leg still open after that is named on the card and in the message. While the server is unreachable nothing fires: an exchange stop is the only guard then." : "Paper: the same engine, no orders, good for practice."}
            {stopLevel !== null && tgtLevel !== null && stopLevel >= tgtLevel ? " The stop is not below the target." : ""}
            {problem ? ` ${problem}.` : ""}
          </p>
        </DialogBody>
        <DialogFooter>
          {target.afterTrade ? (
            <label className="mr-auto flex items-center gap-1 text-2xs text-muted-foreground">
              <Checkbox checked={!protectPrompt} onCheckedChange={(v) => setProtectPrompt(v !== true)} data-testid="rule-no-prompt" />
              do not ask after trades (the card's Protect button stays)
            </label>
          ) : null}
          {target.afterTrade ? <Button variant="ghost" onClick={closeRules} disabled={busy} data-testid="rule-skip">Skip</Button> : <Button variant="ghost" onClick={closeRules} disabled={busy}>Cancel</Button>}
          {armedNow ? <Button variant="outline" loading={clear.isPending} onClick={() => clear.mutate(s.id, { onSuccess: () => { toast("Disarmed", { description: s.name }); closeRules(); }, onError: (e) => toast.error("Could not disarm", { description: e.message }) })} data-testid="rule-disarm">Disarm all</Button> : null}
          <Button variant="primary" onClick={arm} loading={setRules.isPending} disabled={!!problem || (bodies.length === 0 && !armedNow)} data-testid="rule-arm">
            {bodies.length === 0 ? "Remove rules" : `Arm ${kinds.map((k) => RULE_KIND_LABELS[k].toLowerCase()).join(" + ")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

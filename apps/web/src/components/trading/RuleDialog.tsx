"use client";
// Protect (ADR-059 §2.3; HC-TR-167, HC-TR-171): arm the exit rules of a strategy. A stop loss and a target on the
// strategy P&L, typed in money (the trader's currency, stored in USD) or as a percentage of the credit received, the
// debit paid or the max loss; a leg stop on one leg's mark (N × its entry, or a price) that exits that leg alone or
// the whole strategy; a spot level on the underlying; a time exit at an instant or at d days to expiry. When a level
// is crossed the API exits at market, short legs first, and says so in Telegram / mail; the card shows the fired
// state. The dialog is mounted once in the Workspace overlays and opens from the card, Details, the workbench and
// after a trade from the Builder.
import { type RuleBasis, type RuleChannel, type RuleKind, type RuleScope, type RuleTrigger, type StrategyLeg, type StrategyRule, RULE_BASIS_LABELS, RULE_KIND_LABELS, isPositiveDecimal, nearestSettlement, ruleLevel, ruleThresholdUsd, toDecimal } from "@hapiecoin/schema";
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
interface LegDraft {
  on: boolean;
  trigger: "multiple" | "price";
  value: string;
  scope: RuleScope;
}
interface SpotDraft {
  on: boolean;
  trigger: "above" | "below";
  value: string;
}
interface TimeDraft {
  on: boolean;
  trigger: "at" | "dte";
  /** For `at`: a datetime-local string (the trader's clock); for `dte`: whole days. */
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
const legDraftOf = (rule: StrategyRule | undefined): LegDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "price" ? "price" : "multiple", value: rule?.value ?? "", scope: rule?.scope ?? "leg" });
const spotDraftOf = (rule: StrategyRule | undefined): SpotDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "above" ? "above" : "below", value: rule?.value ?? "" });
const timeDraftOf = (rule: StrategyRule | undefined): TimeDraft => ({ on: rule !== undefined, trigger: rule?.trigger === "dte" ? "dte" : "at", value: rule ? (rule.trigger === "at" ? toLocalInput(rule.value) : rule.value) : "" });

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

/** One rule's level as the card and Details show it, whatever its kind. */
export function ruleText(r: StrategyRule, money: MoneyFormat, legs: readonly StrategyLeg[] = []): string {
  if (r.kind === "stop" || r.kind === "target") return `${r.kind} at ${levelText(Number(r.thresholdUsd), money)}${r.trigger === "pct" ? ` (${r.value} %)` : ""}`;
  if (r.kind === "leg_stop") {
    const leg = legs.find((l) => l.id === r.legId);
    return `${leg ? legTag(leg) : "leg"} stop at ${fmtPrice(r.thresholdUsd)}${r.trigger === "multiple" ? ` (${r.value}× entry)` : ""}${r.scope === "strategy" ? ", exits all" : ""}`;
  }
  if (r.kind === "spot") return `spot ${r.trigger === "above" ? "≥" : "≤"} ${fmtPrice(r.thresholdUsd, 0)}`;
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
export const FIRED_LABELS: Record<RuleKind, string> = { stop: "stop fired", target: "target hit", leg_stop: "leg stop fired", spot: "spot level fired", time: "time exit fired" };

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
  const [legStops, setLegStops] = useState<Record<string, LegDraft>>({});
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
    setLegStops(Object.fromEntries(openLegs(s).map((l) => [l.id, legDraftOf(armed.find((r) => r.kind === "leg_stop" && r.legId === l.id))])));
    setSpotD(spotDraftOf(armed.find((r) => r.kind === "spot")));
    setTimeD(timeDraftOf(armed.find((r) => r.kind === "time")));
    setChannels(armed[0]?.channels ?? ["push"]);
    // the drafts are seeded from the strategy as it was when the dialog opened (openedFor and the strategy's arrival only, on purpose)
  }, [openedFor, seedFor]);
  if (!s || !target) return null;
  const toBody = (kind: RuleKind, d: Draft) => {
    if (!d.on) return null;
    if (d.trigger === "money") return isPositiveDecimal(toDecimal(typedToUsd(d.value, money), 2)) ? { kind, trigger: "money" as const, value: toDecimal(typedToUsd(d.value, money), 2), channels } : "invalid";
    const b = basisUsd(d.basis);
    if (b === null) return "no-basis";
    return isPositiveDecimal(d.value) && Number(d.value) <= 1000 ? { kind, trigger: "pct" as const, value: d.value, basis: d.basis, basisUsd: toDecimal(b, 2), channels } : "invalid";
  };
  const stopBody = toBody("stop", stop);
  const tgtBody = toBody("target", tgt);
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
    return { kind: "leg_stop" as const, trigger: d.trigger, value: d.value, legId: l.id, scope: d.scope, channels };
  });
  const spotBody = !spotD.on ? null : !isPositiveDecimal(spotD.value) ? "invalid" : spot !== null && (spotD.trigger === "above" ? spot >= Number(spotD.value) : spot <= Number(spotD.value)) ? "crossed" : { kind: "spot" as const, trigger: spotD.trigger, value: spotD.value, channels };
  const timeIso = timeD.trigger === "at" ? fromLocalInput(timeD.value) : null;
  const timeBody = !timeD.on
    ? null
    : timeD.trigger === "at"
      ? timeIso
        ? Date.parse(timeIso) > Date.now()
          ? { kind: "time" as const, trigger: "at" as const, value: timeIso, channels }
          : "past"
        : "invalid"
      : !/^\d{1,3}$/.test(timeD.value)
        ? "invalid"
        : dteNow !== null && dteNow <= Number(timeD.value)
          ? "crossed"
          : { kind: "time" as const, trigger: "dte" as const, value: timeD.value, channels };
  const all = [stopBody, tgtBody, ...legBodies, spotBody, timeBody];
  const problem = all.includes("invalid") ? "Enter a level greater than 0" : all.includes("no-basis") ? "That basis is not known for this strategy · use money" : all.includes("past") ? "The exit time has already passed" : all.includes("crossed") ? "That level is already crossed · it would fire on the next tick" : null;
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
  const field = (kind: RuleKind, d: Draft, set: (d: Draft) => void, level: number | null) =>
    box(
      `rule-${kind}`,
      d.on,
      (on) => set({ ...d, on }),
      RULE_KIND_LABELS[kind],
      kind === "stop" ? "exit all when P&L falls to" : "exit all when P&L reaches",
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
      </>,
    );
  const legField = (l: StrategyLeg) => {
    const d = legStops[l.id] ?? legDraftOf(undefined);
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
            <select value={d.scope} onChange={(e) => set({ ...d, scope: e.target.value as RuleScope })} className="ml-auto h-7 rounded border border-input bg-background px-1 text-xs" aria-label="What to exit" data-testid={`${id}-scope`}>
              <option value="leg">exit this leg only</option>
              <option value="strategy">exit the whole strategy</option>
            </select>
          </>,
        )}
      </div>
    );
  };
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
      {unit("rule-time", timeD.trigger, [{ key: "at" as const, label: "at a time" }, { key: "dte" as const, label: "days before expiry", title: nearest ? `Nearest expiry ${fmtExpiry(nearest.expiry)}` : "No dated leg" }], (t) => setTimeD({ ...timeD, trigger: t, value: "" }), "When")}
      {timeD.trigger === "at" ? (
        <input type="datetime-local" value={timeD.value} onChange={(e) => setTimeD({ ...timeD, value: e.target.value })} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Exit time" data-testid="rule-time-value" />
      ) : (
        <input type="number" min={0} max={999} step={1} value={timeD.value} onChange={(e) => setTimeD({ ...timeD, value: e.target.value })} className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-xs" aria-label="Days to expiry" data-testid="rule-time-value" disabled={!nearest} />
      )}
      <span className="num text-muted-foreground" data-testid="rule-time-level">
        {timeD.trigger === "at" ? (timeIso ? `= ${fmtInstant(timeIso)} your clock` : "—") : nearest ? `nearest expiry ${fmtExpiry(nearest.expiry)} · ${dteNow} days now` : "no dated leg to count to"}
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
            {field("target", tgt, setTgt, tgtLevel)}
            {open.length ? (
              <>
                <div className="micro mt-1">Leg stops</div>
                {open.map(legField)}
              </>
            ) : null}
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

"use client";
// Protect (ADR-059 §2.3; HC-TR-167): arm a stop loss and a target on a whole strategy. Typed in money (the trader's
// currency, stored in USD) or as a percentage of the credit received, the debit paid or the max loss; the other unit
// shows live. When a level is crossed the API exits every open leg of the strategy at market, short legs first, and
// says so in Telegram / mail; the card shows the fired state. The dialog is mounted once in the Workspace overlays
// and opens from the card, the Details dialog and after a trade from the Builder.
import { type CloseReason, type RuleBasis, type RuleChannel, type RuleKind, type RuleTrigger, type StrategyRule, RULE_BASIS_LABELS, RULE_KIND_LABELS, isPositiveDecimal, ruleThresholdUsd, toDecimal } from "@hapiecoin/schema";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { useClearRules, useSetRules, useStrategies } from "@/lib/api/strategies";
import { useTelegramStatus } from "@/lib/api/telegram";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { openLegs, serverLegToLocal } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";

interface Draft {
  on: boolean;
  trigger: RuleTrigger;
  value: string;
  basis: RuleBasis;
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

/** "−₹5,000 (−$60)" style: the level in the trader's currency, USD beside it when the currency is not USD. */
export function levelText(usd: number, money: MoneyFormat): string {
  const main = fmtMoney(usd, money, { signed: true });
  return money.currency === "USD" ? main : `${main} (${fmtMoney(usd, USD, { signed: true })})`;
}

/** The armed rules of a strategy, one line for the card and the Details dialog: "stop at −₹5,000 · target at +₹4,200". */
export function rulesLine(rules: readonly StrategyRule[] | undefined, money: MoneyFormat): string | null {
  const armed = (rules ?? []).filter((r) => r.state === "armed");
  if (!armed.length) return null;
  return armed.map((r) => `${r.kind === "stop" ? "stop" : "target"} at ${levelText(Number(r.thresholdUsd), money)}${r.trigger === "pct" ? ` (${r.value} %)` : ""}`).join(" · ");
}

/** The most recent fired rule, for the card's chip. */
export function firedRule(rules: readonly StrategyRule[] | undefined): StrategyRule | null {
  const fired = (rules ?? []).filter((r) => r.state === "fired").sort((a, b) => (b.firedAt ?? "").localeCompare(a.firedAt ?? ""));
  return fired[0] ?? null;
}

export const CLOSE_REASON_OF_KIND: Record<RuleKind, CloseReason> = { stop: "stopped", target: "target" };

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
  const lotSize = s ? book.lotSizeOf(s.asset) : "0";
  // the bases: credit received / debit paid from the entry premiums; max loss from the pricing engine at the nearest expiry
  const netPremiumUsd = useMemo(() => open.reduce((sum, l) => sum + (l.side === "sell" ? 1 : -1) * Number(l.entryPrice ?? l.price) * l.lots * Number(lotSize), 0), [open, lotSize]);
  const pricingLegs = useMemo(() => (s ? toPricingLegs(open.map((l) => serverLegToLocal(l, s.asset)), lotSize, { spot: undefined }) : []), [s, open, lotSize]);
  const spot = s ? book.spotOf(s.asset) : null;
  const analysis = useAnalysis(pricingLegs, s && spot !== null && pricingLegs.length ? { spot, nowMs: Date.now(), settlementHourUtc: settlementHourUtc(s.asset), defaultIv: 0.5 } : null);
  const maxLossUsd = analysis.result && Number.isFinite(analysis.result.maxLoss) && analysis.result.maxLoss < 0 ? -analysis.result.maxLoss : null;
  const defaultBasis: RuleBasis = netPremiumUsd > 0 ? "credit" : netPremiumUsd < 0 ? "debit" : "max_loss";
  const basisUsd = (b: RuleBasis): number | null => (b === "credit" ? (netPremiumUsd > 0 ? netPremiumUsd : null) : b === "debit" ? (netPremiumUsd < 0 ? -netPremiumUsd : null) : maxLossUsd);
  const [stop, setStop] = useState<Draft>(draftOf(undefined, "credit", money));
  const [tgt, setTgt] = useState<Draft>(draftOf(undefined, "credit", money));
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
    setChannels(st?.channels ?? tg?.channels ?? ["push"]);
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
  const problem = stopBody === "invalid" || tgtBody === "invalid" ? "Enter a level greater than 0" : stopBody === "no-basis" || tgtBody === "no-basis" ? "That basis is not known for this strategy · use money" : null;
  const bodies = [stopBody, tgtBody].filter((b): b is Exclude<typeof b, string | null> => b !== null && typeof b !== "string");
  const levelOf = (d: Draft, kind: RuleKind): number | null => {
    const b = toBody(kind, d);
    return b && typeof b !== "string" ? Number(ruleThresholdUsd(b)) : null;
  };
  const stopLevel = levelOf(stop, "stop");
  const tgtLevel = levelOf(tgt, "target");
  const armedNow = (s.rules ?? []).some((r) => r.state === "armed");
  const legsWord = `${open.length} open ${open.length === 1 ? "leg" : "legs"}`;
  const busy = setRules.isPending || clear.isPending;
  const arm = () => {
    if (problem) return toast.error("Check the levels", { description: problem });
    setRules.mutate(
      { id: s.id, body: { rules: bodies } },
      {
        onSuccess: () => {
          toast(bodies.length ? "Protected" : "Rules removed", { description: bodies.length ? `${s.name} · ${bodies.map((b) => RULE_KIND_LABELS[b.kind].toLowerCase()).join(" and ")} armed · checked every few seconds by the server` : s.name });
          closeRules();
        },
        onError: (e) => toast.error("Could not arm", { description: e.message }),
      },
    );
  };
  const field = (kind: RuleKind, d: Draft, set: (d: Draft) => void, level: number | null) => (
    <div className={cn("rounded border p-2", d.on ? "border-border" : "border-border/50")} data-testid={`rule-${kind}`} data-on={d.on}>
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox checked={d.on} onCheckedChange={(v) => set({ ...d, on: v === true })} data-testid={`rule-${kind}-on`} />
        {RULE_KIND_LABELS[kind]}
        <span className="micro ml-auto">{kind === "stop" ? "exit all when P&L falls to" : "exit all when P&L reaches"}</span>
      </label>
      {d.on ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded border border-border" role="group" aria-label="Unit">
            {(["money", "pct"] as const).map((t) => (
              <button key={t} type="button" onClick={() => set({ ...d, trigger: t })} className={cn("px-2 py-1", d.trigger === t ? "bg-muted text-foreground" : "text-muted-foreground")} aria-pressed={d.trigger === t} data-testid={`rule-${kind}-${t}`}>
                {t === "money" ? (money.currency === "INR" ? "₹" : "$") : "%"}
              </button>
            ))}
          </div>
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
        </div>
      ) : null}
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && closeRules()}>
      <DialogContent className="sm:max-w-[600px]" data-testid="rule-dialog" data-after-trade={target.afterTrade}>
        <DialogHeader>
          <DialogTitle>Protect {s.name}</DialogTitle>
          <DialogDescription>
            {s.status === "live" ? "HapieCoin sends exit orders" : "HapieCoin closes the paper legs"} for all {legsWord} when a level is crossed: short legs first, market at the mark of that moment, this strategy's lots only. The server checks every few seconds; a fired rule never re-arms.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            {field("stop", stop, setStop, stopLevel)}
            {field("target", tgt, setTgt, tgtLevel)}
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
            {bodies.length === 0 ? "Remove rules" : `Arm ${bodies.map((b) => RULE_KIND_LABELS[b.kind].toLowerCase()).join(" + ")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

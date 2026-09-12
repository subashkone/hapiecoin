"use client";
// The workbench's position and ticket column (ADR-058; HC-TR-150, HC-TR-151): every open leg on one line (side,
// contract, entry → mark, P&L, lots now → after, Close), the proposed rows on one line each with their effect, and
// the "value at" chips with the scenario slider when the combined position spans several expiries.
import { cn } from "@hapiecoin/ui";
import type { StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { daysToExpiry, fmtDate, fmtExpiry, fmtPrice } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { type AdjustPick, type Effect, VALUE_TODAY, instrumentOf, isoDaysFrom, lotsAfterOf } from "@/lib/adjust/model";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";

const EFFECT_CLS: Record<Effect["kind"], string> = {
  new: "border-buy/60 text-foreground",
  add: "border-buy/60 text-buy",
  trim: "border-warning text-warning",
  close: "border-loss text-loss",
  flip: "border-loss text-loss",
};

/** The effect without the contract, for a row that already names it: CLOSES · TRIMS by 10 · ADDS +15 · FLIPS +5 · NEW LEG. */
export function shortEffect(e: Effect): string {
  switch (e.kind) {
    case "close":
      return "CLOSES";
    case "trim":
      return `TRIMS by ${e.lots}`;
    case "add":
      return `ADDS +${e.lots}`;
    case "flip":
      return `FLIPS +${e.lots}`;
    default:
      return "NEW LEG";
  }
}

export function EffectPill({ e }: { e: Effect | undefined }) {
  if (!e) return <span className="micro text-muted-foreground" data-testid="effect-none">unchanged</span>;
  return (
    <span className={cn("micro whitespace-nowrap rounded border px-1", EFFECT_CLS[e.kind])} title={e.label} data-testid="effect" data-kind={e.kind}>
      {shortEffect(e)}
    </span>
  );
}

/** A tenth of the row's size per click (100 → 10 lots, 10 → 1), never less than one; the field takes any whole number. */
export function lotStep(base: number): number {
  return Math.max(1, Math.round(base / 10));
}

function Stepper({ value, min, step, onChange, testId, label }: { value: number; min: 0 | 1; step: number; onChange: (v: number) => void; testId: string; label: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-[2px] border border-input font-mono text-xs" data-testid={testId} data-value={value}>
      <button type="button" className="px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={`Fewer lots · ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} data-testid={`${testId}-down`}>
        −
      </button>
      <input type="number" min={min} step={1} value={value} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))} className="w-12 bg-transparent text-center outline-none" aria-label={`Lots after · ${label}`} data-testid={`${testId}-input`} />
      <button type="button" className="px-1.5 text-muted-foreground hover:text-foreground" aria-label={`More lots · ${label}`} onClick={() => onChange(value + step)} data-testid={`${testId}-up`}>
        +
      </button>
    </span>
  );
}

function SidePill({ side }: { side: "buy" | "sell" }) {
  return <span className={cn("micro w-9 shrink-0 rounded border px-1 text-center font-bold", side === "buy" ? "border-buy bg-buy-bg text-buy" : "border-sell bg-sell-bg text-sell")}>{side.toUpperCase()}</span>;
}

export function PositionTicket({ w }: { w: AdjustWorkbench }) {
  const { a, draft, strategy, open } = w;
  const money = a.money;
  const effectOf = (legId: string) => w.effects.find((e) => e.legId === legId && e.kind !== "flip");
  const pickEffect = (p: AdjustPick) => w.effects.find((e) => e.pickId === p.id);
  const pnlOf = (l: ServerLeg) => {
    const mark = a.markOf(l.symbol);
    if (mark === undefined) return null;
    return (Number(mark) - Number(l.entryPrice ?? l.price)) * l.lots * Number(w.lotSize) * (l.side === "buy" ? 1 : -1);
  };
  const legRow = (l: ServerLeg) => {
    const after = lotsAfterOf(draft, l);
    const mark = a.markOf(l.symbol);
    const pnl = pnlOf(l);
    const changed = after !== l.lots;
    return (
      <div key={l.id} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 rounded border px-2 py-1 text-xs", changed ? "border-warning/60" : "border-border", after === 0 && "opacity-70")} data-testid="wb-leg" data-leg-id={l.id} data-after={after}>
        <SidePill side={l.side} />
        <span className="num min-w-0 truncate">
          <span className="font-medium">{instrumentOf(l)}</span>
          <span className="text-muted-foreground"> · {fmtPrice(l.entryPrice ?? l.price, 1)} → {fmtPrice(mark, 1)}</span>
          <span className={cn("ml-1", pnl !== null && (pnl >= 0 ? "text-profit" : "text-loss"))} data-testid="wb-leg-pnl">{pnl === null ? "—" : fmtMoney(pnl, money, { signed: true })}</span>
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span className="num text-muted-foreground">{l.lots} →</span>
          <Stepper value={after} min={0} step={lotStep(l.lots)} onChange={(v) => w.setLotsAfter(l.id, v)} testId="lots-after" label={instrumentOf(l)} />
        </span>
        <span className="min-w-[56px] text-right sm:min-w-[76px]"><EffectPill e={effectOf(l.id)} /></span>
        {changed ? (
          <button type="button" onClick={() => w.setLotsAfter(l.id, l.lots)} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground" title="Undo · keep this leg as it is" aria-label={`Undo the change to ${instrumentOf(l)}`} data-testid="wb-leg-undo">
            ↺
          </button>
        ) : (
          <button type="button" onClick={() => w.setLotsAfter(l.id, 0)} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-loss hover:text-loss" title="Close this leg at the mark (lots after = 0)" data-testid="wb-leg-close">
            Close
          </button>
        )}
      </div>
    );
  };
  const pickRow = (p: AdjustPick) => {
    const mark = a.markOf(p.symbol) ?? p.price;
    return (
      <div key={p.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 rounded border border-warning/60 px-2 py-1 text-xs" data-testid="wb-pick" data-pick-id={p.id}>
        <SidePill side={p.side} />
        <span className="num min-w-0 truncate">
          <span className="font-medium">{instrumentOf(p)}</span>
          <span className="text-muted-foreground"> · mark {fmtPrice(mark, 1)}</span>
        </span>
        <Stepper value={p.lots} min={1} step={lotStep(p.lots)} onChange={(v) => w.setPickLots(p.id, v)} testId="pick-lots" label={instrumentOf(p)} />
        <span className="min-w-[56px] text-right sm:min-w-[76px]"><EffectPill e={pickEffect(p)} /></span>
        <button type="button" onClick={() => w.removePick(p.id)} aria-label={`Remove ${instrumentOf(p)}`} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-loss hover:text-loss" data-testid="wb-pick-remove">
          ✕
        </button>
      </div>
    );
  };
  // ADR-044 §2.5 / H2 mockup: a lots-after edit is an order too, so it appears under Proposed where it can be edited
  // (the stepper moves lots after: fewer trims, all closes, more adds) or removed (lots after back to lots now)
  const orders = w.effects.filter((e): e is Effect & { legId: string } => e.legId !== undefined && (e.kind === "trim" || e.kind === "close" || e.kind === "add"));
  const orderRow = (e: Effect & { legId: string }) => {
    const l = open.find((x) => x.id === e.legId);
    if (!l) return null;
    const side = e.kind === "add" ? l.side : l.side === "buy" ? "sell" : "buy";
    const setLots = (v: number) => w.setLotsAfter(l.id, e.kind === "add" ? l.lots + v : Math.max(0, l.lots - v));
    return (
      <div key={`order-${l.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 rounded border border-warning/60 px-2 py-1 text-xs" data-testid="wb-order" data-leg-id={l.id} data-kind={e.kind}>
        <SidePill side={side} />
        <span className="num min-w-0 truncate">
          <span className="font-medium">{instrumentOf(l)}</span>
          <span className="text-muted-foreground"> · mark {fmtPrice(a.markOf(l.symbol), 1)}</span>
        </span>
        <Stepper value={e.lots} min={1} step={lotStep(l.lots)} onChange={setLots} testId="order-lots" label={`${e.kind === "add" ? "add to" : "close from"} ${instrumentOf(l)}`} />
        <span className="min-w-[56px] text-right sm:min-w-[76px]"><EffectPill e={e} /></span>
        <button type="button" onClick={() => w.setLotsAfter(l.id, l.lots)} aria-label={`Remove the change to ${instrumentOf(l)}`} title="Remove · keep this leg as it is" className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-loss hover:text-loss" data-testid="wb-order-remove">
          ✕
        </button>
      </div>
    );
  };
  const proposedCount = orders.length + draft.picks.length;
  const latest = w.expiries[w.expiries.length - 1];
  const nearest = w.expiries[0];
  // no explicit choice = the nearest expiry (ADR-059); later legs keep their time value there
  const chosen = draft.valuation === VALUE_TODAY ? VALUE_TODAY : draft.valuation && w.expiries.includes(draft.valuation) ? draft.valuation : draft.valuation && /^\d{4}-\d{2}-\d{2}$/.test(draft.valuation) ? "scenario" : nearest;
  const chips = [VALUE_TODAY, ...w.expiries];
  // scenario slider (ADR-044 extra 2): any day between today and the latest expiry
  const maxDays = latest ? Math.max(0, daysToExpiry(latest, new Date(a.nowMs))) : 0;
  const sliderDays = chosen === VALUE_TODAY ? 0 : chosen === "scenario" && draft.valuation ? Math.max(0, Math.min(maxDays, Math.round((Date.parse(`${draft.valuation}T12:00:00Z`) - a.nowMs) / 86_400_000))) : chosen === latest ? maxDays : chosen && chosen !== VALUE_TODAY ? Math.max(0, Math.min(maxDays, daysToExpiry(chosen, new Date(a.nowMs)))) : maxDays;
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="position-ticket">
      <div className="flex items-center gap-2">
        <span className="micro">Position · {open.length} open {open.length === 1 ? "leg" : "legs"}</span>
        <span className="micro text-muted-foreground">side · contract · entry → mark · P&amp;L</span>
        <span className="micro ml-auto">lots now → after</span>
      </div>
      <div className="flex flex-col gap-1">{open.map(legRow)}</div>
      <p className="text-2xs text-muted-foreground">Set the lots you want to hold after: fewer trims, 0 (or Close) closes, more adds at the mark. The chain's B / S on a strike you hold does the same.</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="micro" data-testid="proposed-count" data-count={proposedCount}>Proposed · {proposedCount}</span>
        {proposedCount === 0 ? (
          <span className="micro ml-auto text-muted-foreground">pick B / S on the chain, or change lots after on a leg</span>
        ) : (
          <>
            <span className="micro ml-auto">every order this change sends · lots · mark · effect</span>
            <button type="button" onClick={w.reset} className="micro rounded border border-border px-1 text-muted-foreground hover:border-loss hover:text-loss" title="Remove every order · the same as Reset (saved plans stay)" data-testid="proposed-clear">
              Clear all
            </button>
          </>
        )}
      </div>
      {proposedCount ? (
        <div className="flex flex-col gap-1">
          {orders.map(orderRow)}
          {draft.picks.map(pickRow)}
        </div>
      ) : null}
      {w.expiries.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="value-at">
          <span className="micro mr-1" title="Today: every leg at its time value now. An expiry: legs settled by then are intrinsic, later legs keep their time value">Value at</span>
          {chips.map((e) => (
            <button key={e} type="button" aria-pressed={e === chosen} onClick={() => w.setValuation(e === nearest ? null : e)} className={cn("rounded border px-1.5 py-0.5 text-2xs", e === chosen ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground")} data-testid="value-at-chip" data-expiry={e}>
              {e === VALUE_TODAY ? "today" : <>{fmtExpiry(e)} <span className="font-mono text-3xs">{daysToExpiry(e)}d</span></>}
            </button>
          ))}
          {maxDays > 0 ? (
            <label className="flex w-full items-center gap-2 text-2xs" title="Scenario: value the combined position on any day up to its latest expiry (dates are UTC, at the settlement hour)">
              <span className="micro w-[72px] shrink-0">Scenario</span>
              <input type="range" min={0} max={maxDays} step={1} value={sliderDays} onChange={(e) => { const d = Number(e.target.value); w.setValuation(d === 0 ? VALUE_TODAY : d >= maxDays && latest ? latest : isoDaysFrom(a.nowMs, d)); }} className="flex-1 accent-[hsl(var(--curve))]" aria-label="Scenario date, days ahead" data-testid="scenario-days" />
              <span className="num w-[96px] text-right sm:w-[120px]" data-testid="scenario-label">{sliderDays === 0 ? "today" : `+${sliderDays}d · ${fmtDate(isoDaysFrom(a.nowMs, sliderDays))}`}</span>
            </label>
          ) : null}
        </div>
      ) : null}
      {strategy.adjustments.length ? <div className="micro mt-1 text-muted-foreground">Adjusted {strategy.adjustments.length} {strategy.adjustments.length === 1 ? "time" : "times"} before · history in Details</div> : null}
    </div>
  );
}

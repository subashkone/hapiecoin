"use client";
// The workbench's position and ticket column (HC-TR-150, HC-TR-151): every open leg with a "lots now → after"
// stepper (fewer trims, 0 closes, more adds at the mark), the proposed new legs with their own stepper, the
// effect of each row in words, and the "value at" chips when the combined position spans several expiries.
import { cn } from "@hapiecoin/ui";
import type { StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { daysToExpiry, fmtExpiry, fmtPrice } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { type AdjustPick, type Effect, VALUE_TODAY, instrumentOf, lotsAfterOf } from "@/lib/adjust/model";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";

const EFFECT_CLS: Record<Effect["kind"], string> = {
  new: "border-buy/60 text-foreground",
  add: "border-buy/60 text-buy",
  trim: "border-warning text-warning",
  close: "border-loss text-loss",
  flip: "border-loss text-loss",
};

export function EffectPill({ e }: { e: Effect | undefined }) {
  if (!e) return <span className="micro text-muted-foreground" data-testid="effect-none">unchanged</span>;
  return (
    <span className={cn("micro rounded border px-1", EFFECT_CLS[e.kind])} data-testid="effect" data-kind={e.kind}>
      {e.label}
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
    return (
      <div key={l.id} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 rounded border border-border px-2 py-1.5 text-xs", after === 0 && "opacity-70")} data-testid="wb-leg" data-leg-id={l.id} data-after={after}>
        <span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span>
        <span className="num min-w-0 truncate">
          {instrumentOf(l)}
          <span className="text-muted-foreground"> · entry {fmtPrice(l.entryPrice ?? l.price, 1)} → mark {fmtPrice(mark, 1)}</span>
        </span>
        <span className={cn("num text-right", pnl !== null && (pnl >= 0 ? "text-profit" : "text-loss"))} data-testid="wb-leg-pnl">{pnl === null ? "—" : fmtMoney(pnl, money, { signed: true })}</span>
        <span className="micro col-start-1">lots</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="num text-muted-foreground">{l.lots} →</span>
          <Stepper value={after} min={0} step={lotStep(l.lots)} onChange={(v) => w.setLotsAfter(l.id, v)} testId="lots-after" label={instrumentOf(l)} />
        </span>
        <span className="text-right"><EffectPill e={effectOf(l.id)} /></span>
      </div>
    );
  };
  const pickRow = (p: AdjustPick) => {
    const mark = a.markOf(p.symbol) ?? p.price;
    return (
      <div key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 rounded border border-warning/60 px-2 py-1.5 text-xs" data-testid="wb-pick" data-pick-id={p.id}>
        <span className={cn("font-mono text-3xs font-bold uppercase", p.side === "buy" ? "text-buy" : "text-sell")}>{p.side}</span>
        <span className="num min-w-0 truncate">
          {instrumentOf(p)}
          <span className="text-muted-foreground"> · mark {fmtPrice(mark, 1)}</span>
        </span>
        <button type="button" onClick={() => w.removePick(p.id)} aria-label={`Remove ${instrumentOf(p)}`} className="text-muted-foreground hover:text-loss" data-testid="wb-pick-remove">
          ✕
        </button>
        <span className="micro col-start-1">lots</span>
        <span className="flex items-center gap-2">
          <Stepper value={p.lots} min={1} step={lotStep(p.lots)} onChange={(v) => w.setPickLots(p.id, v)} testId="pick-lots" label={instrumentOf(p)} />
        </span>
        <span className="text-right"><EffectPill e={pickEffect(p)} /></span>
      </div>
    );
  };
  const latest = w.expiries[w.expiries.length - 1];
  const chosen = draft.valuation === VALUE_TODAY ? VALUE_TODAY : draft.valuation && w.expiries.includes(draft.valuation) ? draft.valuation : latest;
  const chips = [VALUE_TODAY, ...w.expiries];
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="position-ticket">
      <div className="flex items-center gap-2">
        <span className="micro">Position · {open.length} open {open.length === 1 ? "leg" : "legs"}</span>
        <span className="micro ml-auto">after: {w.countAfter} {w.countAfter === 1 ? "leg" : "legs"}</span>
      </div>
      <div className="flex flex-col gap-1">{open.map(legRow)}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="micro">Proposed · {draft.picks.length}</span>
        {draft.picks.length === 0 ? <span className="micro ml-auto text-muted-foreground">pick B / S on the chain, or change lots after on a leg</span> : null}
      </div>
      {draft.picks.length ? <div className="flex flex-col gap-1">{draft.picks.map(pickRow)}</div> : null}
      {w.expiries.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="value-at">
          <span className="micro mr-1" title="Today: every leg at its time value now. An expiry: legs settled by then are intrinsic, later legs keep their time value">Value at</span>
          {chips.map((e) => (
            <button key={e} type="button" aria-pressed={e === chosen} onClick={() => w.setValuation(e === latest ? null : e)} className={cn("rounded border px-1.5 py-0.5 text-2xs", e === chosen ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} data-testid="value-at-chip" data-expiry={e}>
              {e === VALUE_TODAY ? "today" : <>{fmtExpiry(e)} <span className="font-mono text-3xs">{daysToExpiry(e)}d</span></>}
            </button>
          ))}
        </div>
      ) : null}
      {strategy.adjustments.length ? <div className="micro mt-1 text-muted-foreground">Adjusted {strategy.adjustments.length} {strategy.adjustments.length === 1 ? "time" : "times"} before · history in Details</div> : null}
    </div>
  );
}

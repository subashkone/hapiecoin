"use client";
// Adjustment workbench (ADR-044; HC-TR-148..152), layout H2: the position and ticket on the left, the live
// chain on the right, the analysis pane shows the position after the change. The footer carries the change
// summary, the guard rails and Review; under 720 px the two columns stack and the footer stays in view.
import { Button, cn } from "@hapiecoin/ui";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "@/lib/api/live";
import { type AdjustBody } from "@hapiecoin/schema";
import { lotsAfterOf, toBody } from "@/lib/adjust/model";
import { useAdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { ChainPickerBody, type PickerKind, type PickerRow, usePickerChain } from "@/components/builder/ChainPickerBody";
import { ModePill } from "@/components/trading/StrategyDetailsDialog";
import { AdjustConfirmDialog } from "./AdjustConfirmDialog";
import { PositionTicket } from "./PositionTicket";

export const STACK_BELOW_PX = 720;

/** Width of an element, so the workbench can stack its columns by its own box rather than the viewport. */
function useWide(ref: React.RefObject<HTMLElement | null>, px: number): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWide(e.contentRect.width >= px);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return wide;
}

export function AdjustWorkbench({ book }: { book: PaperBook }) {
  const w = useAdjustWorkbench();
  const closeAdjust = useUiStore((s) => s.closeAdjust);
  const chainLots = useUiStore((s) => s.chainLots);
  const box = useRef<HTMLElement>(null);
  const wide = useWide(box, STACK_BELOW_PX);
  const strategy = w?.strategy;
  const firstExpiry = strategy?.legs.find((l) => l.kind !== "future" && l.status === "open")?.expiry ?? null;
  const chain = usePickerChain(strategy?.asset ?? "BTC", strategy !== undefined, firstExpiry);
  const [review, setReview] = useState<AdjustBody | null>(null);
  // the strategy went away (archived, deleted, or the list refreshed without it): leave the workbench
  useEffect(() => {
    if (w === null) closeAdjust();
  }, [w, closeAdjust]);
  if (!w || !strategy) return null;
  const { a, draft, open } = w;
  const stateOf = (strike: string, kind: PickerKind) => {
    const held = open.find((l) => l.kind === kind && Number(l.strike) === Number(strike) && l.expiry === chain.expiry);
    const pick = draft.picks.find((p) => p.kind === kind && Number(p.strike) === Number(strike) && p.expiry === chain.expiry);
    return { picked: pick?.side, held: held ? { side: held.side, lots: held.lots, after: lotsAfterOf(draft, held) } : undefined };
  };
  const onToggle = (kind: PickerKind, side: "buy" | "sell", row: PickerRow) => {
    const q = kind === "call" ? row.call : row.put;
    if (!q || !chain.expiry) return;
    w.pick({ kind, side, strike: row.strike, expiry: chain.expiry, lots: chainLots, price: q.mark, iv: q.markIv });
  };
  const openReview = () => {
    if (w.empty || w.overCap) return;
    setReview(toBody(draft, open, a.markOf, { idempotencyKey: newIdempotencyKey() }));
  };
  const canReview = !w.empty && !w.overCap;
  return (
    <section ref={box} className="flex h-full min-h-0 flex-col" data-testid="adjust-workbench" data-strategy={strategy.id} data-layout={wide ? "columns" : "stacked"} data-empty={w.empty ? "true" : "false"}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="micro">Adjusting</span>
        <b className="truncate">{strategy.name}</b>
        <ModePill status={strategy.status} />
        <span className="micro rounded border border-border px-1">{strategy.asset}</span>
        <span className={cn("micro ml-auto", w.stale ? "text-warning" : "text-muted-foreground")} title="Time since the last quote for the legs in this change" data-testid="adjust-mark-age">
          marks {w.markAgeSec}s ago
        </span>
        <Button size="sm" variant="ghost" onClick={w.exit} title="Leave the workbench · the draft is discarded" data-testid="adjust-exit">
          Exit
        </Button>
      </header>
      <div className={cn("grid min-h-0 flex-1 overflow-auto", wide ? "grid-cols-[minmax(300px,5fr)_minmax(360px,6fr)]" : "grid-cols-1")}>
        <div className={cn("min-w-0", wide && "overflow-auto border-r border-border")}>
          <PositionTicket w={w} />
        </div>
        <div className={cn("min-w-0 p-3", wide && "overflow-auto")}>
          <div className="mb-1 flex items-center gap-2 text-2xs">
            <span className="micro">Chain</span>
            <span className="text-muted-foreground">B / S on a held strike adds or trims it; on any other strike it proposes a new leg · {chainLots} lots per click</span>
          </div>
          <ChainPickerBody asset={strategy.asset} expiries={chain.expiries} expiry={chain.expiry} onExpiry={chain.setExpiry} rows={chain.rows} atm={chain.atm} stateOf={stateOf} onToggle={onToggle} keyboard onEnter={openReview} onEscape={w.reset} boxClass={wide ? "max-h-[calc(100vh-260px)]" : "max-h-[46vh]"} testId="wb-chain" />
        </div>
      </div>
      <footer className="sticky bottom-0 flex flex-col gap-1 border-t border-border bg-background px-3 py-2" data-testid="adjust-footer">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
          <span className="min-w-0 flex-1 truncate" data-testid="adjust-summary">{w.empty ? "No change yet" : `This change: ${w.summary.line || "pricing…"}`}</span>
          {!w.empty && Math.abs(w.cash) >= 0.005 ? <span className={cn("num", w.cash > 0 ? "text-profit" : "text-loss")} data-testid="adjust-cash">{w.cash > 0 ? "credit" : "debit"} {fmtMoney(Math.abs(w.cash), a.money)}</span> : null}
        </div>
        {w.summary.warnings.length ? (
          <ul className="flex flex-col gap-0.5 text-2xs text-warning" data-testid="adjust-warnings">
            {w.summary.warnings.map((x) => (
              <li key={x} data-testid="adjust-warning">⚠ {x}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="micro text-muted-foreground">Enter reviews · Esc resets · A on a card opens this</span>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={w.empty} onClick={w.reset} data-testid="adjust-reset">
            Reset
          </Button>
          <Button size="sm" disabled={!canReview} onClick={openReview} title={w.overCap ? "Over the open-leg cap" : w.empty ? "Nothing to review yet" : "Review the change before it is applied"} data-testid="adjust-review">
            Review {w.effects.length ? `${w.effects.length} ${w.effects.length === 1 ? "change" : "changes"}` : ""} →
          </Button>
        </div>
      </footer>
      {review ? <AdjustConfirmDialog open={true} onOpenChange={(o) => !o && setReview(null)} w={w} body={review} brokerName={book.brokerName(strategy.brokerId)} onDone={() => setReview(null)} /> : null}
    </section>
  );
}

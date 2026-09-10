"use client";
// Adjustment workbench (ADR-044, ADR-058; HC-TR-148..152), layout H2: the position and ticket on the left with the
// four footer tiles and Review, the chain in the H2 form on the right (quick fixes and plans above it), and the
// analysis pane showing "This change" with the six before → after tiles. Under 720 px the two columns stack.
import { Button, cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { newIdempotencyKey } from "@/lib/api/live";
import { useBrokers } from "@/lib/api/queries";
import { type AdjustBody } from "@hapiecoin/schema";
import { lotsAfterOf, toBody } from "@/lib/adjust/model";
import { useAdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { marginEstimate } from "@/lib/strategy/analysis";
import { MAX_OPEN_LEGS_UI, feeFor } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { type PickerKind, type PickerRow, usePickerChain } from "@/components/builder/ChainPickerBody";
import { ModePill } from "@/components/trading/StrategyDetailsDialog";
import { AdjustConfirmDialog } from "./AdjustConfirmDialog";
import { PlansBar } from "./PlansBar";
import { PositionTicket } from "./PositionTicket";
import { QuickFixes } from "./QuickFixes";
import { WorkbenchChain } from "./WorkbenchChain";

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

function FooterTile({ label, value, sub, title, tone, testId }: { label: string; value: string; sub?: string | undefined; title?: string | undefined; tone?: "profit" | "loss" | "warning" | undefined; testId: string }) {
  return (
    <div className="min-w-0 rounded border border-border px-2 py-1.5" title={title} data-testid={testId}>
      <div className="micro truncate">{label}</div>
      <div className={cn("num truncate text-[15px] font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "warning" && "text-warning")}>{value}</div>
      {sub ? <div className="num truncate text-2xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function AdjustWorkbench({ book }: { book: PaperBook }) {
  const w = useAdjustWorkbench();
  const closeAdjust = useUiStore((s) => s.closeAdjust);
  const chainLots = useUiStore((s) => s.chainLots);
  const openAlerts = useUiStore((s) => s.openAlerts);
  const { data: brokers } = useBrokers();
  const [alertInput, setAlertInput] = useState("");
  const box = useRef<HTMLElement>(null);
  const wide = useWide(box, STACK_BELOW_PX);
  const strategy = w?.strategy;
  const firstExpiry = strategy?.legs.find((l) => l.kind !== "future" && l.status === "open")?.expiry ?? null;
  const chain = usePickerChain(strategy?.asset ?? "BTC", strategy !== undefined, firstExpiry);
  const [review, setReview] = useState<AdjustBody | null>(null);
  // the strategy went away (archived, deleted, or the list refreshed without it): leave the workbench
  useEffect(() => {
    if (w === null) closeAdjust(true);
  }, [w, closeAdjust]);
  // HC-TR-096 model: fees on what the change trades (new legs, added lots, trimmed lots), at the mark
  const fees = useMemo(() => {
    if (!w || w.a.spot === null) return null;
    const broker = (brokers ?? []).find((b) => b.id === w.strategy.brokerId) ?? brokers?.[0];
    const traded: { id: string; kind: string; lots: number; price: string }[] = [];
    for (const l of w.open) {
      const after = lotsAfterOf(w.draft, l);
      if (after !== l.lots) traded.push({ id: l.id, kind: l.kind, lots: Math.abs(after - l.lots), price: w.a.markOf(l.symbol) ?? l.entryPrice ?? l.price });
    }
    for (const p of w.draft.picks) traded.push({ id: p.id, kind: p.kind, lots: p.lots, price: w.a.markOf(p.symbol) ?? p.price });
    return traded.length ? feeFor(traded, w.a.spot, w.lotSize, broker) : null;
  }, [w, brokers]);
  if (!w || !strategy) return null;
  const { a, draft, open } = w;
  const money = a.money;
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
  const room = MAX_OPEN_LEGS_UI - w.countAfter;
  const capLine = w.overCap ? `over the ${MAX_OPEN_LEGS_UI} open-leg cap after netting` : room === 0 ? `at the ${MAX_OPEN_LEGS_UI} open-leg cap after netting` : `${room} more open ${room === 1 ? "leg" : "legs"} allowed after netting`;
  // footer tiles (H2): what the change costs or pays, the loss after, the margin estimate after, the leg count after
  const marginBefore = a.before ? marginEstimate(a.before) : null;
  const marginAfter = a.result ? marginEstimate(a.result) : null;
  const money$ = (v: number | undefined, unlimited = "Unlimited") => (v === undefined ? "—" : fmtMoney(v, money, { unlimited }));
  const lossWorse = a.before && a.result ? a.result.maxLoss < a.before.maxLoss : false;
  const lossBetter = a.before && a.result ? a.result.maxLoss > a.before.maxLoss : false;
  // Exit goes through the guarded closeAdjust: with orders or saved plans the store parks it and AdjustDiscardDialog asks
  const setAlert = () => {
    const v = Number(alertInput);
    if (!Number.isFinite(v) || v <= 0) return;
    // typed in the display currency, the alert is kept in USD like every other figure (ADR-052)
    const usd = money.currency === "INR" ? v / (Number(money.rate) || 1) : v;
    openAlerts({ kind: "pnl", strategyId: strategy.id, asset: strategy.asset, op: "<=", value: String(-Math.round(usd * 100) / 100) });
    setAlertInput("");
  };
  return (
    <section ref={box} className="flex h-full min-h-0 flex-col" data-testid="adjust-workbench" data-strategy={strategy.id} data-layout={wide ? "columns" : "stacked"} data-empty={w.empty ? "true" : "false"}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="micro">Adjusting</span>
        <b className="truncate">{strategy.name}</b>
        <ModePill status={strategy.status} />
        <span className="micro rounded border border-border px-1">{strategy.asset}</span>
        <span className="micro rounded border border-border px-1" title="Every open leg is valued at its entry; the change is priced at the live mark">locked at entry</span>
        <span className={cn("micro ml-auto", w.stale ? "text-warning" : "text-muted-foreground")} title="Time since the last quote for the legs in this change" data-testid="adjust-mark-age">
          marks {w.markAgeSec}s ago
        </span>
        <Button size="sm" variant="ghost" onClick={() => closeAdjust()} title="Leave the workbench · the change and saved plans are discarded" data-testid="adjust-exit">
          Exit
        </Button>
      </header>
      <div className={cn("grid min-h-0 flex-1 overflow-auto", wide ? "grid-cols-[minmax(320px,11fr)_minmax(380px,10fr)]" : "grid-cols-1")}>
        <div className={cn("flex min-w-0 flex-col", wide && "overflow-auto border-r border-border")}>
          <PositionTicket w={w} />
        </div>
        <div className={cn("min-w-0 p-3", wide && "overflow-auto")}>
          <QuickFixes w={w} expiry={chain.expiry} rows={chain.rows} expiries={chain.expiries} />
          <PlansBar w={w} />
          <WorkbenchChain expiries={chain.expiries} expiry={chain.expiry} onExpiry={chain.setExpiry} rows={chain.rows} atm={chain.atm} spot={a.spot} capLine={capLine} lotsPerClick={chainLots} stateOf={stateOf} onToggle={onToggle} onEnter={openReview} onEscape={w.reset} />
        </div>
      </div>
      {/* sticks above the portfolio bar (h-8) so Review is never hidden behind it when the page scrolls */}
      <footer className="sticky bottom-8 flex flex-col gap-2 border-t border-border bg-background px-3 py-2" data-testid="adjust-footer">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="adjust-tiles">
          <FooterTile label={w.empty || Math.abs(w.cash) < 0.005 ? "You receive / pay" : w.cash > 0 ? "You receive" : "You pay"} value={w.empty ? "—" : fmtMoney(Math.abs(w.cash), money)} sub={fees ? `fees est. ${fmtMoney(fees.total, money)}` : "at mark"} title={fees ? `Fees on what this change trades: brokerage ${fmtMoney(fees.fee, money)} + GST ${fmtMoney(fees.gst, money)}` : "Credit or debit of the change, every leg at its mark"} tone={w.empty || Math.abs(w.cash) < 0.005 ? undefined : w.cash > 0 ? "profit" : "loss"} testId="adjust-tile-cash" />
          <FooterTile label="Max loss after" value={money$(a.result?.maxLoss)} sub={a.before ? `${money$(a.before.maxLoss)} → ${lossWorse ? "▼ worse" : lossBetter ? "▲ better" : "same"}` : undefined} title="Worst case of the combined position at the valuation date, before → after" tone={a.result && !Number.isFinite(a.result.maxLoss) ? "loss" : lossWorse ? "loss" : lossBetter ? "profit" : undefined} testId="adjust-tile-loss" />
          <FooterTile label="Margin est." value={a.result ? (marginAfter === null ? "Unlimited" : fmtMoney(marginAfter, money)) : "—"} sub={a.before ? `${marginBefore === null ? "Unlimited" : fmtMoney(marginBefore, money)} before` : "worst expiry loss"} title="Estimate: the worst loss at expiry of the combined position. The venue's margin held and available appear at Review" tone={marginAfter === null && a.result ? "loss" : undefined} testId="adjust-tile-margin" />
          <FooterTile label="Open legs after" value={String(w.countAfter)} sub={`of ${MAX_OPEN_LEGS_UI} · ${open.length} now`} tone={w.overCap ? "warning" : undefined} testId="adjust-tile-legs" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-2xs">
          <span className="flex items-center gap-1.5" title="Opens the Alerts center with a P&L alert for this strategy filled in · checked every tick while the app is open and every five minutes by the server" data-testid="risk-alert">
            <span className="micro">Alert me if P&amp;L falls below</span>
            <input type="number" min={1} value={alertInput} onChange={(e) => setAlertInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setAlert()} placeholder={money.currency === "INR" ? "₹ loss" : "$ loss"} className="h-6 w-20 rounded border border-input bg-background px-1.5 text-xs" aria-label="Loss threshold for a P&L alert" data-testid="risk-alert-input" />
            <Button size="sm" variant="ghost" disabled={!(Number(alertInput) > 0)} onClick={setAlert} data-testid="risk-alert-save">Set alert</Button>
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={w.empty} onClick={w.reset} title="Discard the change (Esc on the chain does the same)" data-testid="adjust-reset">
            Reset
          </Button>
          <Button size="sm" disabled={!canReview} onClick={openReview} title={w.overCap ? "Over the open-leg cap" : w.empty ? "Nothing to review yet · pick B / S on the chain or change lots after on a leg" : "Review the change before it is applied · marks are re-read when Review opens (Enter on the chain does the same)"} data-testid="adjust-review">
            Review {w.effects.length ? `${w.effects.length} ${w.effects.length === 1 ? "order" : "orders"}` : ""} →
          </Button>
        </div>
      </footer>
      {review ? <AdjustConfirmDialog open={true} onOpenChange={(o) => !o && setReview(null)} w={w} body={review} brokerName={book.brokerName(strategy.brokerId)} onDone={() => setReview(null)} /> : null}
    </section>
  );
}

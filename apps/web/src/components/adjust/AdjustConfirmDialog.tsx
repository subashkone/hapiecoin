"use client";
// Review and confirm an adjustment (ADR-044; HC-TR-151, HC-TR-152). Paper: an amber frame, the change list,
// the before → after figures, the cash and an optional reason, applied at the marks shown. Live: a red frame,
// the venue's preview of the proposed batch (adds as entries, trims / closes as reduce-only exits), the mark
// band, and "Place N orders"; the marks reviewed here travel with the batch as the expected prices.
import type { AdjustBody } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useLivePreview } from "@/lib/api/live";
import { strategyKeys, useAdjustStrategy } from "@/lib/api/strategies";
import { MAX_ADJUST_REASON } from "@hapiecoin/schema";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { instrumentOf } from "@/lib/adjust/model";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { useUiStore } from "@/lib/store";
import { ModePill } from "@/components/trading/StrategyDetailsDialog";
import { EffectPill } from "./PositionTicket";

export function AdjustConfirmDialog({ open, onOpenChange, w, body, brokerName, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; w: AdjustWorkbench; body: AdjustBody; brokerName: string; onDone: () => void }) {
  const { a, strategy } = w;
  const live = strategy.status === "live";
  const money = a.money;
  const adjust = useAdjustStrategy();
  const preview = useLivePreview();
  const closeAdjust = useUiStore((s) => s.closeAdjust);
  const openDetails = useUiStore((s) => s.openDetails);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const orders = body.changes.length + body.adds.length;
  const worst = a.result && Number.isFinite(a.result.maxLoss) ? a.result.maxLoss : null;
  // live: price the proposed batch on the venue every time the dialog opens (fresh marks, fresh key)
  useEffect(() => {
    // one preview per opening: the body and the mutation are fixed for this review, so only the opening is a dependency
    if (open && live && strategy.brokerId) preview.mutate({ id: strategy.id, body: { brokerId: strategy.brokerId, adds: body.adds, changes: body.changes, ...(worst === null ? {} : { worstLoss: worst }) } });
  }, [open, live, strategy.id, strategy.brokerId]);
  const venue = preview.data ?? null;
  // live: nothing is placeable until the venue has priced this exact batch and passed it
  const blocked = live && venue?.ok !== true;
  const confirm = () =>
    adjust.mutate(
      { id: strategy.id, body: { ...body, ...(reason.trim() ? { reason: reason.trim() } : {}) } },
      {
        onSuccess: (s) => {
          onDone();
          closeAdjust();
          if (s) openDetails(s.id);
          const failed = s ? s.orders.filter((o) => o.batchId === body.idempotencyKey && o.state === "failed").length : 0;
          if (failed) toast.error("Adjustment partly refused", { description: `${failed} ${failed === 1 ? "order" : "orders"} failed · use Retry on the Live tab` });
          else toast.success(live ? "Adjustment orders placed" : "Adjustment applied", { description: `${orders} ${orders === 1 ? "change" : "changes"} · ${live ? "filled at market" : "at the marks shown"}` });
        },
        onError: (e) => {
          // the position may have moved on the server (a batch stopped after some fills is 502): refresh it and start the draft again from what is open now
          void qc.invalidateQueries({ queryKey: strategyKeys.all });
          const partly = e instanceof ApiError && e.status === 502;
          if (partly) {
            onDone();
            w.reset();
          }
          toast.error(partly ? "Adjustment stopped part-way" : live ? "Adjustment refused" : "Could not apply the adjustment", { description: partly ? `${e.message} · the position was refreshed; rebuild the rest from what is open now` : e.message });
        },
      },
    );
  const legName = (legId: string) => {
    const l = w.open.find((x) => x.id === legId);
    return l ? instrumentOf(l) : legId;
  };
  const before = a.before;
  const after = a.result;
  const fig = (label: string, b: string, x: string, testId: string) => (
    <div data-testid={testId}>
      <div className="micro">{label}</div>
      <div className="num text-xs">
        <span className="text-muted-foreground">{b}</span> <span aria-hidden>→</span> <b>{x}</b>
      </div>
    </div>
  );
  const money$ = (v: number | undefined, unlimited: string) => (v === undefined ? "—" : fmtMoney(v, money, { unlimited }));
  const pct = (p: number | undefined) => (p === undefined || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(0)}%`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-[640px]", live ? "border-loss" : "border-warning")} data-testid="adjust-confirm" data-mode={live ? "live" : "paper"}>
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              {live ? "Confirm adjustment orders" : "Confirm adjustment"} <ModePill status={strategy.status} />
            </span>
          </DialogTitle>
          <DialogDescription>
            {strategy.name} · {live ? brokerName : "simulated at the marks shown"} · marks {w.markAgeSec}s old
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <table className="w-full text-xs" data-testid="adjust-confirm-rows">
            <thead>
              <tr className="micro text-left">
                <th className="py-1 pr-2">Change</th>
                <th className="py-1 pr-2">Instrument</th>
                <th className="py-1 pr-2 text-right">Lots</th>
                <th className="py-1 text-right">{live ? "Mark" : "Price"}</th>
              </tr>
            </thead>
            <tbody>
              {body.changes.map((c) => (
                <tr key={c.legId} className="border-t border-border" data-testid="adjust-confirm-row" data-kind={c.lotsAfter === 0 ? "close" : "trim"}>
                  <td className="py-1 pr-2"><EffectPill e={w.effects.find((e) => e.legId === c.legId && (e.kind === "trim" || e.kind === "close"))} /></td>
                  <td className="num py-1 pr-2">{legName(c.legId)}</td>
                  <td className="num py-1 pr-2 text-right">→ {c.lotsAfter}</td>
                  <td className="num py-1 text-right">{fmtPrice(c.price, 1)}</td>
                </tr>
              ))}
              {body.adds.map((l, i) => (
                <tr key={`${l.symbol}-${i}`} className="border-t border-border" data-testid="adjust-confirm-row" data-kind="add">
                  <td className="py-1 pr-2"><span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span></td>
                  <td className="num py-1 pr-2">{l.kind === "future" ? l.symbol : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} ${fmtExpiry(l.expiry)}`}</td>
                  <td className="num py-1 pr-2 text-right">+{l.lots}</td>
                  <td className="num py-1 text-right">{fmtPrice(l.price, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="adjust-confirm-figures">
            {fig("Max loss", money$(before?.maxLoss, "Unlimited"), money$(after?.maxLoss, "Unlimited"), "cf-max-loss")}
            {fig("Max profit", money$(before?.maxProfit, "Unlimited"), money$(after?.maxProfit, "Unlimited"), "cf-max-profit")}
            {fig("POP", pct(before?.pop), pct(after?.pop), "cf-pop")}
            <div data-testid="cf-cash">
              <div className="micro">{w.cash >= 0 ? "You receive" : "You pay"}</div>
              <div className={cn("num text-xs font-medium", w.cash >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(Math.abs(w.cash), money)}</div>
            </div>
          </div>
          {w.summary.warnings.length ? (
            <ul className="mt-2 flex flex-col gap-0.5 text-2xs text-warning" data-testid="adjust-confirm-warnings">
              {w.summary.warnings.map((x) => (
                <li key={x}>⚠ {x}</li>
              ))}
            </ul>
          ) : null}
          {live ? (
            <div className={cn("mt-3 rounded border p-2 text-2xs", venue ? (venue.ok ? "border-profit/40" : "border-loss/60") : "border-border")} data-testid="adjust-venue" data-ok={venue ? String(venue.ok) : "pending"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="micro">Exchange check</span>
                <span className={cn(venue ? (venue.ok ? "text-profit" : "text-loss") : "text-muted-foreground")} data-testid="adjust-venue-verdict">
                  {preview.isPending ? "checking…" : preview.isError ? preview.error.message : venue ? (venue.ok ? "ok · contracts sized, products live, within limits" : venue.reasons.join(" · ")) : "—"}
                </span>
              </div>
              {venue ? (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>notional <b className="num text-foreground">{venue.notional} USD</b></span>
                  <span>available <b className="num text-foreground">{venue.available ? `${venue.available} ${venue.availableAsset ?? ""}` : "—"}</b></span>
                  <span>margin held <b className="num text-foreground">{venue.marginUsed ?? "—"}</b></span>
                  <span>band <b className="num text-foreground">±{venue.limits.markBandPct}%</b> of the marks shown</span>
                </div>
              ) : null}
              <div className="mt-1 text-loss">Orders go to {brokerName} at market with real funds; exits first, then entries. A leg whose mark moved outside the band is refused and stays open for Retry.</div>
            </div>
          ) : (
            <div className="mt-3 rounded border border-warning/50 p-2 text-2xs" data-testid="adjust-paper-note">Paper: trims and closes book realised P&L at the marks shown; new legs enter at their mark. Nothing goes to the exchange.</div>
          )}
          <label className="mt-3 flex flex-col gap-1 text-2xs">
            <span className="micro">Why this change (kept with the strategy, optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, MAX_ADJUST_REASON))} placeholder="e.g. spot ran above the wings; rolling up" className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Reason" data-testid="adjust-reason" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="adjust-cancel">Back</Button>
          <Button variant={live ? "destructive" : "primary"} disabled={blocked || adjust.isPending} loading={adjust.isPending} onClick={confirm} data-testid="adjust-apply">
            {live ? `Place ${orders} ${orders === 1 ? "order" : "orders"} →` : "Apply adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

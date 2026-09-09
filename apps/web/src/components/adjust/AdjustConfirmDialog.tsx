"use client";
// Review and confirm an adjustment (ADR-044; HC-TR-151, HC-TR-152). Paper: an amber frame, the change list,
// the before → after figures, the cash and an optional reason, applied at the marks shown. Live: a red frame,
// the venue's preview of the proposed batch (adds as entries, trims / closes as reduce-only exits), the mark
// band per leg, the order type (market, or a limit at the reviewed mark), hold-to-place, and the fill state of
// every order once placed; the marks reviewed here travel with the batch as the expected prices.
import type { AdjustBody, OrderType, Strategy } from "@hapiecoin/schema";
import { MAX_ADJUST_REASON } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useLivePreview } from "@/lib/api/live";
import { strategyKeys, useAdjustStrategy } from "@/lib/api/strategies";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { instrumentOf } from "@/lib/adjust/model";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { useUiStore } from "@/lib/store";
import { ModePill } from "@/components/trading/StrategyDetailsDialog";
import { EffectPill } from "./PositionTicket";

/** How long the live button must be held before the batch goes (ADR-044 decision 2: a live confirm is mechanically different). */
export const HOLD_MS = 1200;

/** A button that fires only after being held for `ms` (pointer, or Space / Enter held down); letting go early resets. */
export function HoldButton({ ms, disabled, onFire, children, testId }: { ms: number; disabled: boolean; onFire: () => void; children: React.ReactNode; testId: string }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  };
  const start = () => {
    if (disabled || timer.current) return;
    started.current = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - started.current) / ms);
      setProgress(p);
      if (p >= 1) {
        stop();
        onFire();
      }
    }, 40);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onBlur={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      className="relative inline-flex h-8 items-center overflow-hidden rounded border border-loss bg-loss/90 px-3 text-xs font-medium text-white outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      title="Press and hold (pointer, Space or Enter) to place; letting go early cancels"
      data-testid={testId}
      data-progress={progress.toFixed(2)}
    >
      <span className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${progress * 100}%` }} aria-hidden />
      <span className="relative">{children}</span>
    </button>
  );
}

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
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [placed, setPlaced] = useState<Strategy | null>(null);
  const orders = body.changes.length + body.adds.length;
  const worst = a.result && Number.isFinite(a.result.maxLoss) ? a.result.maxLoss : null;
  // live: price the proposed batch on the venue every time the dialog opens (fresh marks, fresh key)
  useEffect(() => {
    // one preview per opening: the body and the mutation are fixed for this review, so only the opening is a dependency
    if (open && live && strategy.brokerId) preview.mutate({ id: strategy.id, body: { brokerId: strategy.brokerId, adds: body.adds, changes: body.changes, ...(worst === null ? {} : { worstLoss: worst }) } });
  }, [open, live, strategy.id, strategy.brokerId]);
  const venue = preview.data ?? null;
  const bandPct = venue?.limits.markBandPct ?? 5;
  /** Reviewed mark vs the mark now, against the venue band. */
  const band = (symbol: string, reviewed: string) => {
    const now = a.markOf(symbol);
    if (now === undefined || !(Number(reviewed) > 0)) return { text: "—", over: false };
    const moved = (Math.abs(Number(now) - Number(reviewed)) / Number(reviewed)) * 100;
    return { text: moved < 0.05 ? "at mark" : `moved ${moved.toFixed(1)}%`, over: moved > bandPct };
  };
  // a leg whose mark already moved outside the band would be refused on the venue: review again instead of placing
  const anyOver = live && body.adds.some((l) => band(l.symbol, l.price).over);
  // live: nothing is placeable until the venue has priced this exact batch and passed it, and every mark is still inside the band
  const blocked = live && (venue?.ok !== true || anyOver);
  const overBalance = venue !== null && venue.ok && venue.available !== null && Number(venue.notional) > Number(venue.available);
  const finish = (s: Strategy | null) => {
    onDone();
    closeAdjust();
    if (s) openDetails(s.id);
  };
  const confirm = () =>
    adjust.mutate(
      { id: strategy.id, body: { ...body, orderType: live ? orderType : "market", ...(reason.trim() ? { reason: reason.trim() } : {}) } },
      {
        onSuccess: (s) => {
          const batch = s ? s.orders.filter((o) => o.batchId === body.idempotencyKey) : [];
          const failed = batch.filter((o) => o.state === "failed").length;
          const pending = batch.filter((o) => o.state === "pending").length;
          if (live && s) {
            setPlaced(s); // the fill states stay on screen until Done
            if (failed) toast.error("Adjustment partly refused", { description: `${failed} ${failed === 1 ? "order" : "orders"} failed · use Retry on the Live tab` });
            else if (pending) toast(`${pending} ${pending === 1 ? "limit order rests" : "limit orders rest"} on the exchange`, { description: "Sync on the Live tab books them when they fill" });
            else toast.success("Adjustment orders placed", { description: `${batch.length} ${batch.length === 1 ? "order" : "orders"} filled${orderType === "limit" ? " at their limits" : " at market"}` });
            return;
          }
          finish(s);
          toast.success("Adjustment applied", { description: `${orders} ${orders === 1 ? "change" : "changes"} at the marks shown` });
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
  const results = placed ? placed.orders.filter((o) => o.batchId === body.idempotencyKey) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (!o && placed ? finish(placed) : onOpenChange(o))}>
      <DialogContent className={cn("sm:max-w-[680px]", live ? "border-loss" : "border-warning")} data-testid="adjust-confirm" data-mode={live ? "live" : "paper"} data-stage={results ? "placed" : "review"}>
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              {results ? "Orders placed" : live ? "Confirm adjustment orders" : "Confirm adjustment"} <ModePill status={strategy.status} />
            </span>
          </DialogTitle>
          <DialogDescription>
            {strategy.name} · {live ? brokerName : "simulated at the marks shown"} · marks {w.markAgeSec}s old
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {results ? (
            <>
              <table className="w-full text-xs" data-testid="adjust-results">
                <thead>
                  <tr className="micro text-left">
                    <th className="py-1 pr-2">Order</th>
                    <th className="py-1 pr-2 text-right">Contracts</th>
                    <th className="py-1 text-right">State</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((o) => (
                    <tr key={o.id} className="border-t border-border" data-testid="adjust-result" data-state={o.state}>
                      <td className="py-1 pr-2">
                        <span className={cn("font-mono text-3xs font-bold uppercase", o.side === "buy" ? "text-buy" : "text-sell")}>{o.side}</span> <span className="num">{o.symbol}</span> <span className="micro text-muted-foreground">{o.purpose === "exit" ? "exit" : o.orderType}</span>
                      </td>
                      <td className="num py-1 pr-2 text-right">{o.size}</td>
                      <td className="py-1 text-right">
                        <span className={cn("micro rounded border px-1", o.state === "filled" || o.state === "closed" ? "border-profit text-profit" : o.state === "pending" ? "border-warning text-warning" : "border-loss text-loss")} title={o.error ?? undefined}>
                          {o.state === "filled" || o.state === "closed" ? `filled @ ${fmtPrice(o.fillPrice ?? undefined, 1)}` : o.state === "pending" ? "resting · sync books it" : `failed · ${o.error ?? "refused"}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 rounded border border-border p-2 text-2xs text-muted-foreground">Filled legs are booked; resting limits fill on the exchange and Sync books them; failed legs stay open for Retry on the Live tab. Details shows the batch in the adjustment history.</div>
            </>
          ) : (
            <>
              <table className="w-full text-xs" data-testid="adjust-confirm-rows">
                <thead>
                  <tr className="micro text-left">
                    <th className="py-1 pr-2">Change</th>
                    <th className="py-1 pr-2">Instrument</th>
                    <th className="py-1 pr-2 text-right">Lots</th>
                    <th className="py-1 text-right">{live ? "Mark" : "Price"}</th>
                    {live ? <th className="py-1 pl-2 text-right">Band</th> : null}
                    {live ? <th className="py-1 pl-2 text-right">Type</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {body.changes.map((c) => (
                    <tr key={c.legId} className="border-t border-border" data-testid="adjust-confirm-row" data-kind={c.lotsAfter === 0 ? "close" : "trim"}>
                      <td className="py-1 pr-2"><EffectPill e={w.effects.find((e) => e.legId === c.legId && (e.kind === "trim" || e.kind === "close"))} /></td>
                      <td className="num py-1 pr-2">{legName(c.legId)}</td>
                      <td className="num py-1 pr-2 text-right">→ {c.lotsAfter}</td>
                      <td className="num py-1 text-right">{fmtPrice(c.price, 1)}</td>
                      {live ? <td className="num py-1 pl-2 text-right text-muted-foreground">reduce-only</td> : null}
                      {live ? <td className="py-1 pl-2 text-right text-muted-foreground">market</td> : null}
                    </tr>
                  ))}
                  {body.adds.map((l, i) => {
                    const b = band(l.symbol, l.price);
                    const limit = live && orderType === "limit" && body.expected[l.symbol] !== undefined;
                    return (
                      <tr key={`${l.symbol}-${i}`} className="border-t border-border" data-testid="adjust-confirm-row" data-kind="add" data-band={b.over ? "over" : "ok"}>
                        <td className="py-1 pr-2"><span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span></td>
                        <td className="num py-1 pr-2">{l.kind === "future" ? l.symbol : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} ${fmtExpiry(l.expiry)}`}</td>
                        <td className="num py-1 pr-2 text-right">+{l.lots}</td>
                        <td className="num py-1 text-right">{fmtPrice(l.price, 1)}</td>
                        {live ? <td className={cn("num py-1 pl-2 text-right", b.over ? "text-loss" : "text-muted-foreground")} title={`Refused if the venue mark is more than ±${bandPct}% from ${fmtPrice(l.price, 1)}`} data-testid="adjust-band">{b.text} · ±{bandPct}%</td> : null}
                        {live ? <td className="py-1 pl-2 text-right text-muted-foreground" data-testid="adjust-type">{limit ? "limit" : "market"}</td> : null}
                      </tr>
                    );
                  })}
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
              {w.summary.warnings.length || overBalance ? (
                <ul className="mt-2 flex flex-col gap-0.5 text-2xs text-warning" data-testid="adjust-confirm-warnings">
                  {w.summary.warnings.map((x) => (
                    <li key={x}>⚠ {x}</li>
                  ))}
                  {overBalance ? <li data-testid="adjust-margin-warning">⚠ The batch's premium notional exceeds the available balance on the exchange; the venue may refuse it</li> : null}
                  {anyOver ? <li data-testid="adjust-band-warning">⚠ A mark moved outside the band since Review: go Back and review again</li> : null}
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
                  <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="adjust-order-type">
                    <span className="micro">order type</span>
                    {(["market", "limit"] as const).map((t) => (
                      <button key={t} type="button" aria-pressed={orderType === t} onClick={() => setOrderType(t)} className={cn("rounded border px-1.5 py-0.5 text-2xs", orderType === t ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} data-testid={`order-type-${t}`}>
                        {t === "market" ? "Market" : "Limit at mark"}
                      </button>
                    ))}
                    <span className="text-muted-foreground">{orderType === "limit" ? "entries rest at the reviewed mark until filled; exits stay market" : "entries and exits fill at market within the band"}</span>
                  </div>
                  <div className="mt-1 text-loss">Orders go to {brokerName} with real funds; exits first, then entries. A leg whose mark moved outside the band is refused and stays open for Retry.</div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-warning/50 p-2 text-2xs" data-testid="adjust-paper-note">Paper: trims and closes book realised P&L at the marks shown; new legs enter at their mark. Nothing goes to the exchange.</div>
              )}
              <label className="mt-3 flex flex-col gap-1 text-2xs">
                <span className="micro">Why this change (kept with the strategy, optional)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, MAX_ADJUST_REASON))} placeholder="e.g. spot ran above the wings; rolling up" className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Reason" data-testid="adjust-reason" />
              </label>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {results ? (
            <Button variant="primary" onClick={() => finish(placed)} data-testid="adjust-done">Done → Details</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="adjust-cancel">Back</Button>
              {live ? (
                <HoldButton ms={HOLD_MS} disabled={blocked || adjust.isPending} onFire={confirm} testId="adjust-apply">
                  {adjust.isPending ? "Placing…" : `Hold to place ${orders} ${orders === 1 ? "order" : "orders"}`}
                </HoldButton>
              ) : (
                <Button variant="primary" disabled={adjust.isPending} loading={adjust.isPending} onClick={confirm} data-testid="adjust-apply">
                  Apply adjustment
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

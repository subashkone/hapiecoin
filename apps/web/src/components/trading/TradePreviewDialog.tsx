"use client";
// Trade Preview (HC-TR-056, HC-TR-057): the legs as they will be tracked, fees, what you pay or receive,
// spot, margin estimate, then "Trade now".
import type { Broker, LivePreview, Underlying } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from "@hapiecoin/ui";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import type { FeeEstimate } from "@/lib/strategy/paper";
import { type TradeLegView, feeLine, netPremium } from "./TradeModeDialog";

export interface TradePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "paper" | "live";
  asset: Underlying;
  legs: TradeLegView[];
  spot: number | null;
  lotSize: string;
  money: MoneyFormat;
  broker: Broker | undefined;
  fees: FeeEstimate;
  /** Worst defined loss at expiry (margin estimate), or null when unbounded / unknown. */
  maxLoss: number | null;
  customPrices: boolean;
  busy: boolean;
  /** Server-side venue preview (live only): contracts, marks, notional, wallet and safeguard verdicts. */
  venue?: LivePreview | null | undefined;
  onTrade: () => void;
}

export function legLabel(l: TradeLegView): string {
  return l.kind === "future" ? l.symbol : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} · ${fmtExpiry(l.expiry)}`;
}

export function TradePreviewDialog(p: TradePreviewProps) {
  const lot = Number(p.lotSize);
  const np = netPremium(p.legs, p.lotSize);
  const net = np - p.fees.total;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" data-testid="trade-preview" data-tour="trade-modal">
        <DialogHeader>
          <DialogTitle>Trade Preview</DialogTitle>
          <DialogDescription>Review your strategy before trading</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="preview-table">
              <thead>
                <tr className="micro text-left">
                  <th className="py-1 pr-2">Side</th>
                  <th className="py-1 pr-2">Instrument</th>
                  <th className="py-1 pr-2 text-right">Lots</th>
                  <th className="py-1 pr-2 text-right">Price</th>
                  <th className="py-1 pr-2 text-right">Value</th>
                  <th className="py-1 text-right">Fee</th>
                </tr>
              </thead>
              <tbody>
                {p.legs.map((l) => {
                  const pf = p.fees.per.find((x) => x.id === l.id) ?? { fee: 0, gst: 0 };
                  return (
                    <tr key={l.id} className="border-t border-border" data-testid="preview-row">
                      <td className={cn("py-1 pr-2 font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</td>
                      <td className="num py-1 pr-2">{legLabel(l)}</td>
                      <td className="num py-1 pr-2 text-right">{l.lots}</td>
                      <td className="num py-1 pr-2 text-right">{fmtPrice(l.price, 1)}</td>
                      <td className="num py-1 pr-2 text-right">{fmtMoney(Number(l.price) * l.lots * lot, p.money)}</td>
                      <td className="num py-1 text-right text-muted-foreground">{fmtMoney(pf.fee + pf.gst, p.money)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-2xs">
            <dt className="text-muted-foreground">Net premium</dt>
            <dd className={cn("num", np >= 0 && "text-profit")}>{np >= 0 ? "Credit " : "Debit "}{fmtMoney(Math.abs(np), p.money)}</dd>
            <dt className="text-muted-foreground">Fees · est.<span className="block text-3xs">{feeLine(p.broker)}</span></dt>
            <dd className="num">{fmtMoney(p.fees.total, p.money)}</dd>
            <dt className="font-medium">{net >= 0 ? "You will receive" : "You will pay"}</dt>
            <dd className={cn("num font-medium", net >= 0 && "text-profit")} data-testid="preview-net">{fmtMoney(Math.abs(net), p.money)}</dd>
            <dt className="text-muted-foreground">Current {p.asset} price</dt>
            <dd className="num">{p.spot === null ? "—" : fmtMoney(p.spot, p.money)}</dd>
            <dt className="text-muted-foreground">Expected required margin</dt>
            <dd className="num">{p.maxLoss === null ? "— (undefined risk)" : fmtMoney(Math.abs(p.maxLoss), p.money)}</dd>
            <dt className="text-muted-foreground">Exchange</dt>
            <dd>{p.broker?.name ?? "—"}</dd>
          </dl>
          {p.venue ? (
            <div className="mt-3 rounded border border-border p-2 text-2xs" data-testid="venue-preview" data-ok={p.venue.ok}>
              <div className="micro mb-1">Exchange check · {p.venue.ok ? "ready to place" : "blocked"}</div>
              <table className="w-full">
                <thead><tr className="micro text-left"><th className="pr-2">Symbol</th><th className="pr-2 text-right">Contracts</th><th className="pr-2 text-right">Mark</th><th className="text-right">Notional</th></tr></thead>
                <tbody>
                  {p.venue.legs.map((l) => (
                    <tr key={l.legId} className="num" data-testid="venue-leg"><td className="pr-2">{l.symbol}</td><td className="pr-2 text-right">{l.contracts ?? "—"}</td><td className="pr-2 text-right">{l.mark ?? "—"}</td><td className="text-right">{fmtMoney(Number(l.notional), p.money)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 flex flex-wrap gap-x-3">
                <span>Notional <b className="num">{fmtMoney(Number(p.venue.notional), p.money)}</b></span>
                <span>Available <b className="num">{p.venue.available ? `${p.venue.available} ${p.venue.availableAsset ?? ""}` : "—"}</b></span>
                <span title="Margin the exchange holds against your open positions right now; Delta has no pre-trade estimate (ADR-029)">Margin in use <b className="num" data-testid="venue-margin-used">{p.venue.marginUsed ? `${p.venue.marginUsed} ${p.venue.availableAsset ?? "USD"}` : "—"}</b></span>
                <span className="text-muted-foreground">band ±{p.venue.limits.markBandPct} % · max {p.venue.limits.maxLegs} legs · max {p.venue.limits.maxNotionalUsd.toLocaleString("en-US")} USD</span>
              </div>
              {p.venue.reasons.length ? <ul className="mt-1 list-disc pl-4 text-loss" data-testid="venue-reasons">{p.venue.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
            </div>
          ) : null}
          <div className={cn("mt-3 rounded border p-2 text-2xs", p.mode === "live" ? "border-loss/40" : "border-info/30 bg-info-bg text-info")} data-testid="preview-note">
            {p.mode === "live"
              ? "You are about to trade this strategy. Orders will be placed on Delta Exchange. Prices may differ from displayed estimates. Ensure you have sufficient margin."
              : `Paper trade · positions will be tracked at ${p.customPrices ? "your entered prices" : "live market prices"}. No real orders are placed.`}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={p.onTrade} loading={p.busy} disabled={p.venue !== null && p.venue !== undefined && !p.venue.ok} variant={p.mode === "live" ? "destructive" : "primary"} data-testid="trade-now" data-tour="trade-confirm-button">
            {p.mode === "live" ? "Place live orders →" : "Trade now →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

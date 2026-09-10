"use client";
// Trade Preview (HC-TR-056, HC-TR-057): the legs as they will be tracked, fees, what you pay or receive,
// spot, margin estimate, then "Trade now".
import type { Broker, LivePreview, Underlying } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from "@hapiecoin/ui";
import { useEffect } from "react";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { emitTour } from "@/lib/tour";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import type { FeeEstimate } from "@/lib/strategy/paper";
import { type TradeLegView, feeLine, netPremium } from "./TradeModeDialog";
import { ModePill } from "./StrategyDetailsDialog";

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
  /** False on paths that do not price the worst loss (Go live from a card): "not computed", not "undefined risk". */
  maxLossKnown?: boolean | undefined;
  customPrices: boolean;
  busy: boolean;
  /** Server-side venue preview (live only): contracts, marks, notional, wallet and safeguard verdicts. */
  venue?: LivePreview | null | undefined;
  /** Exchange wallet available balance (HC-TR-158), when an exchange is connected; paper shows it too. */
  available?: { amount: number; asset: string } | null | undefined;
  onTrade: () => void;
}

export function legLabel(l: TradeLegView): string {
  return l.kind === "future" ? l.symbol : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} · ${fmtExpiry(l.expiry)}`;
}

export function TradePreviewDialog(p: TradePreviewProps) {
  useEffect(() => {
    if (p.open) emitTour("trade-preview-open"); // the tour's "paper or live" step advances (HC-SH-072)
  }, [p.open]);
  const lot = Number(p.lotSize);
  const np = netPremium(p.legs, p.lotSize);
  const net = np - p.fees.total;
  // capital (HC-TR-158): the capital at risk is the worst loss at expiry, which the engine reports net of the premium
  // (a credit received or a debit paid is already inside it), never less than a debit paid; the exchange's own margin
  // exists only after placement (ADR-029). "Worst case leaves" = the wallet minus that loss minus fees.
  const known = p.maxLossKnown ?? true;
  const debit = np < 0 ? -np : 0;
  const required = p.maxLoss === null ? null : Math.max(Math.max(0, -p.maxLoss), debit);
  const toUsd = (amount: number, asset: string): number | null => (asset === "USD" || asset === "USDT" || asset === "USDC" ? amount : asset === "INR" ? amount / (Number(p.money.rate) || 1) : null);
  // live: the exchange check's own figure (one source of truth on this dialog); paper: the wallet poll
  const walletRaw = p.venue?.available ? { amount: Number(p.venue.available), asset: p.venue.availableAsset ?? "USD" } : p.available ?? null;
  const avail = walletRaw ? toUsd(walletRaw.amount, walletRaw.asset) : null;
  const after = avail === null || required === null ? null : avail - required - p.fees.total;
  const pct = avail !== null && avail > 0 && required !== null ? Math.round((required / avail) * 100) : null;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" data-testid="trade-preview" data-tour="trade-preview">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Trade Preview <ModePill status={p.mode} /></DialogTitle>
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
          <div className={cn("mt-3 grid grid-cols-2 gap-2 rounded border p-2 text-2xs sm:grid-cols-4", pct !== null && pct > 100 ? "border-loss/60" : pct !== null && pct > 50 ? "border-warning/60" : "border-border")} data-testid="preview-capital" data-pct={pct ?? undefined}>
            <div><div className="micro">Capital at risk</div><div className="num text-[13px] font-medium" data-testid="preview-capital-required">{required === null ? (known ? "not capped" : "not computed") : fmtMoney(required, p.money)}</div><div className="micro">{required === null ? (known ? "undefined risk · the exchange sets the margin at placement" : "see the card's max loss · the exchange sets the margin at placement") : debit > 0 && required === debit ? "the premium paid · exchange margin at placement" : "worst loss at expiry · exchange margin at placement"}</div></div>
            <div><div className="micro">Available</div><div className="num text-[13px] font-medium" data-testid="preview-capital-available">{avail !== null ? fmtMoney(avail, p.money) : walletRaw ? `${walletRaw.amount} ${walletRaw.asset}` : "—"}</div><div className="micro">{walletRaw ? `${walletRaw.asset} wallet · ${pct === null ? (avail === null ? "not a cash asset" : "—") : `${pct}% used by this trade`}` : p.mode === "paper" ? "connect an exchange to see your wallet" : "wallet not read"}</div></div>
            <div><div className="micro">Fees · est.</div><div className="num text-[13px] font-medium">{fmtMoney(p.fees.total, p.money)}</div><div className="micro">{np >= 0 ? "credit" : "debit"} {fmtMoney(Math.abs(np), p.money)} before fees</div></div>
            <div><div className="micro">Worst case leaves</div><div className={cn("num text-[13px] font-medium", after !== null && after < 0 && "text-loss")} data-testid="preview-capital-after">{after === null ? "—" : fmtMoney(after, p.money)}</div><div className="micro">{after !== null && after < 0 ? "short of capital" : required === null ? "needs a capped loss to say" : "available − capital at risk − fees"}</div></div>
          </div>
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

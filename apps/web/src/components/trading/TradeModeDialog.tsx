"use client";
// Select Trading Mode (HC-TR-050..055): Paper · Simulated or Live · Real money, exchange select with the fee
// summary, and the warnings. Live continues only when the exchange is connected; in Phase 3 item 1 the live
// path is disabled with a note (item 2 adds the venue calls).
import type { Broker, Underlying } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { type FeeEstimate, feeFor } from "@/lib/strategy/paper";

export interface TradeLegView {
  id: string;
  kind: "call" | "put" | "future";
  side: "buy" | "sell";
  strike: string;
  expiry: string;
  symbol: string;
  lots: number;
  /** Price used for the ticket (live mark or custom), decimal string. */
  price: string;
}

export interface TradeModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  asset: Underlying;
  legs: TradeLegView[];
  spot: number | null;
  lotSize: string;
  money: MoneyFormat;
  brokers: Broker[];
  connected: boolean;
  priceModeLabel: string;
  /** Preselect Live and disable the Paper card (Go live from a paper strategy). */
  lockLive?: boolean | undefined;
  onContinue: (mode: "paper" | "live", brokerId: string, fees: FeeEstimate) => void;
}

/** Net premium in USD: credit positive, debit negative. */
export function netPremium(legs: readonly TradeLegView[], lotSize: string): number {
  return legs.reduce((sum, l) => sum + (l.side === "sell" ? 1 : -1) * Number(l.price) * l.lots * Number(lotSize), 0);
}

export function feeLine(b: Broker | undefined): string {
  if (!b) return "no exchange selected";
  return `${b.name.replace("Delta Exchange", "Delta")} · fee ${b.feePct}% of notional · cap ${b.feeCapPct}% of premium${Number(b.gstPct) ? ` · GST ${b.gstPct}%` : " · no GST"}`;
}

export function TradeModeDialog(p: TradeModeProps) {
  const [mode, setMode] = useState<"paper" | "live">(p.lockLive ? "live" : "paper");
  const [brokerId, setBrokerId] = useState("");
  const [err, setErr] = useState(false);
  const openSettings = useUiStore((s) => s.openDialog);
  useEffect(() => {
    if (p.open && !brokerId && p.brokers[0]) setBrokerId(p.brokers[0].id);
  }, [p.open, p.brokers, brokerId]);
  useEffect(() => {
    if (p.open && p.lockLive) setMode("live");
  }, [p.open, p.lockLive]);
  const broker = p.brokers.find((b) => b.id === brokerId);
  const fees = feeFor(p.legs, p.spot ?? 0, p.lotSize, broker);
  const np = netPremium(p.legs, p.lotSize);
  const live = mode === "live";
  const liveBlocked = live && !p.connected;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="trade-mode">
        <DialogHeader>
          <DialogTitle>Select Trading Mode</DialogTitle>
          <DialogDescription>Choose how you want to trade {p.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-2 gap-2" data-tour="trade-modal">
            {(["paper", "live"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} disabled={m === "paper" && p.lockLive === true} onClick={() => setMode(m)} className={cn("rounded border p-3 text-left", mode === m ? "border-foreground/50 bg-muted/40" : "border-border hover:border-foreground/30")} data-testid={`mode-${m}`}>
                <b className="flex items-center gap-2 text-[13px]">
                  <span className={cn("micro rounded border px-1", m === "live" ? "border-loss text-loss" : "border-border")}>{m === "live" ? "Live" : "Paper"}</span>
                  {m === "live" ? "Live · Real money" : "Paper · Simulated"}
                </b>
                <span className="mt-1 block text-2xs text-muted-foreground">{m === "live" ? "Real money. Orders are placed on the exchange at market with real funds." : "Simulated positions tracked at live market prices. No real orders are placed."}</span>
                <span className="micro mt-1 block">{m === "live" ? (p.connected ? "exchange connected" : "exchange not connected") : "fees simulated"} · {fmtMoney(fees.total, p.money)} est.</span>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <div className="micro mb-1">Exchange</div>
            <select className="h-8 w-full rounded border border-input bg-background px-2 text-xs" value={brokerId} onChange={(e) => { setBrokerId(e.target.value); setErr(false); }} aria-label="Exchange" data-testid="trade-broker">
              <option value="">Select exchange...</option>
              {p.brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · Fee {b.feePct}% · GST {b.gstPct}% · Cap {b.feeCapPct}%
                </option>
              ))}
            </select>
            {err ? <div className="mt-1 text-2xs text-loss">Please select an exchange</div> : null}
          </div>
          <div className="mt-3 rounded border border-border p-2 text-2xs" data-testid="fee-summary">
            <div className="micro">Fee summary</div>
            <div>{feeLine(broker)}</div>
            <div>
              → est. <b>{fmtMoney(fees.total, p.money)}</b> for {p.legs.length} {p.legs.length === 1 ? "leg" : "legs"} ({fmtMoney(fees.fee, p.money)} fee{fees.gst ? ` + ${fmtMoney(fees.gst, p.money)} GST` : ""})
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-2xs">
            <dt className="text-muted-foreground">Legs</dt>
            <dd className="num">{p.legs.length}</dd>
            <dt className="text-muted-foreground">Asset</dt>
            <dd className="num">{p.asset}</dd>
            <dt className="text-muted-foreground">Net premium</dt>
            <dd className={cn("num", np >= 0 && "text-profit")} data-testid="trade-net">{np >= 0 ? "Credit " : "Debit "}{fmtMoney(Math.abs(np), p.money)}</dd>
            <dt className="text-muted-foreground">Price mode</dt>
            <dd>{p.priceModeLabel}</dd>
          </dl>
          {live && !p.connected ? (
            <div className="mt-3 rounded border border-warning/40 bg-warning-bg p-2 text-2xs" data-testid="trade-not-connected">
              <b>Not Connected</b>
              <div>Connect your exchange in Settings → API Settings to enable live trading</div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => { p.onOpenChange(false); openSettings("api"); }}>
                Open API Settings
              </Button>
            </div>
          ) : null}
          {live ? (
            <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="trade-real-money">
              <b className="text-loss">Real Money Trading</b>
              <div>Orders will be placed on Delta Exchange with real funds. Prices may differ from estimates. You may lose money.</div>
              <div className="micro mt-1">Every order is checked by the server first: exchange connected, contracts sized, mark within {"5 %"} of the preview, wallet and limits.</div>
            </div>
          ) : (
            <div className="mt-3 rounded border border-info/30 bg-info-bg p-2 text-2xs text-info" data-testid="trade-paper-note">
              <b>Paper Trading</b>
              <div>Simulated positions tracked with live market prices. No real orders are placed.</div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={liveBlocked}
            title={liveBlocked ? "Connect your exchange first" : undefined}
            onClick={() => {
              if (!brokerId) {
                setErr(true);
                return;
              }
              p.onContinue(mode, brokerId, fees);
            }}
            data-testid="trade-continue"
            data-tour="trade-confirm-button"
          >
            {live ? "Continue · Live" : "Continue · Paper"} →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

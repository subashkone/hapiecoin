"use client";
// Option details (HC-WS-026): titled with the Delta symbol, the live figures of one option, and Buy / Sell
// with a lots select that adds a leg the same way the chain's row control does, and the 24 h mark / IV sparkline
// from the API's snapshot history (ADR-056, GAPS #32).
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { chainTopic } from "@hapiecoin/schema";
import { CURRENT_VENUE, exerciseLabel, exerciseStyleOf } from "@/lib/venue";
import { useMemo, useState } from "react";
import { useMarkHistory } from "@/lib/api/market";
import { useSettings } from "@/lib/api/queries";
import { Chart } from "@/components/analytics/Chart";
import { daysToExpiry, fmtChange, fmtDelta, fmtExpiry, fmtGamma, fmtIv, fmtOi, fmtPrice, fmtQty, fmtStrike, fmtTheta, fmtVega } from "@/lib/format";
import { useSpot, useTopic } from "@/lib/gateway/hooks";
import { useUiStore } from "@/lib/store";
import { LOT_PRESETS, type LegSide, MAX_ACTIVE_LEGS, venueSymbol, legQuantity } from "@/lib/strategy/legs";
import type { DialogProps } from "./SettingsDialogs";

function Stat({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div>
      <div className="micro">{k}</div>
      <div className={cn("num text-[13px]", className)}>{v}</div>
    </div>
  );
}

export function OptionDetailsDialog({ open, onOpenChange }: DialogProps) {
  const target = useUiStore((s) => s.optionDetail);
  const chainLots = useUiStore((s) => s.chainLots);
  const setChainLots = useUiStore((s) => s.setChainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  // Select the stable map, not a derived array: a fresh `[]` per render would re-render forever.
  const legsByAsset = useUiStore((s) => s.legs);
  const assetLegs = target ? legsByAsset[target.asset] : [];
  const { data: settings } = useSettings();
  const topic = target && open ? chainTopic(CURRENT_VENUE, target.asset, target.expiry) : null;
  const chain = useTopic(topic);
  const spot = useSpot(target?.asset ?? "BTC");
  const [lots, setLots] = useState<number | null>(null);
  const chosen = lots ?? chainLots;

  const history = useMarkHistory(open && target ? venueSymbol(target.kind, target.asset, target.strike, target.expiry) : null);
  const spark = history.data?.points ?? [];
  const row = useMemo(() => (target && chain ? chain.rows.find((r) => Number(r.strike) === Number(target.strike)) : undefined), [chain, target]);
  const q = target ? (target.kind === "call" ? row?.call : row?.put) : undefined;
  const symbol = target ? venueSymbol(target.kind, target.asset, target.strike, target.expiry) : "";
  const lotSize = target ? settings?.lotSizes[target.asset] : undefined;
  const qty = legQuantity(chosen, lotSize);
  const atLimit = assetLegs.filter((l) => l.status === "open").length >= MAX_ACTIVE_LEGS;
  const change = fmtChange(q?.change24hPct);

  const add = (side: LegSide) => {
    if (!target || !q) return;
    const r = addLeg({ asset: target.asset, kind: target.kind, side, strike: target.strike, expiry: target.expiry, lots: chosen, price: q.mark, iv: q.markIv });
    if (r.ok) {
      setChainLots(chosen);
      toast("Leg added", { description: `${side.toUpperCase()} ${r.leg.lots} × ${r.leg.symbol} @ ${fmtPrice(r.leg.price)}` });
      onOpenChange(false);
    } else {
      toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="option-details">
        <DialogHeader>
          <DialogTitle className="font-mono" data-testid="option-symbol">
            {symbol}
          </DialogTitle>
          <DialogDescription data-testid="option-description">
            {target
              ? `${target.kind.toUpperCase()} · ${target.asset} · ${fmtExpiry(target.expiry)} · ${daysToExpiry(target.expiry)} d to expiry · Spot ${fmtPrice(spot?.price)} · ${exerciseLabel(exerciseStyleOf(target.asset))}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!q ? (
            <p className="text-sm text-muted-foreground" data-testid="option-empty">
              No live quote for {target ? `${fmtStrike(target.strike)} ${target.kind}` : "this option"} yet.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-2xl font-medium" data-testid="option-mark">
                  {fmtPrice(q.mark)}
                </span>
                <span className="micro rounded border border-border px-1.5 py-0.5">IV {fmtIv(q.markIv)}</span>
                <span className={cn("micro rounded border px-1.5 py-0.5", change.dir === "up" && "border-profit text-profit", change.dir === "down" && "border-loss text-loss")}>
                  {change.text} 24h
                </span>
                <span className="micro ml-auto">USD per {target?.asset ?? "unit"} · mark</span>
              </div>
              <div className="mt-3" data-testid="option-sparkline" data-points={spark.length} data-state={history.isLoading ? "loading" : spark.length ? "ready" : "empty"}>
                <div className="micro mb-1">Mark and IV · last 24 h · {spark.length ? `${spark.length} snapshots` : history.isLoading ? "loading" : "no history yet"}</div>
                {spark.length > 1 ? (
                  <Chart
                    h={72}
                    yTicks={1}
                    legend={false}
                    x={spark.map((p) => new Date(p.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}
                    series={[
                      { label: "Mark", type: "line", data: spark.map((p) => p.mark), color: "hsl(var(--foreground))", width: 1.2, fmt: (v) => fmtPrice(v) },
                      { label: "IV", type: "line", axis: "r", data: spark.map((p) => (p.markIv === null ? null : p.markIv * 100)), color: "hsl(var(--spot))", width: 1, fmt: (v) => `${v.toFixed(1)}%` },
                    ]}
                    rightAxis
                    yFmt={(v) => fmtPrice(v, 0)}
                    y2Fmt={(v) => `${v.toFixed(0)}%`}
                    testId="chart-option-spark"
                  />
                ) : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="option-stats">
                <Stat k="Bid / Ask" v={`${fmtPrice(q.bid)} / ${fmtPrice(q.ask)}`} />
                <Stat k="OI" v={fmtOi(q.oi)} />
                <Stat k="Volume 24h" v={fmtQty(q.volume24h)} />
                <Stat k="Bid / Ask qty" v={`${fmtQty(q.bidQty)} / ${fmtQty(q.askQty)}`} />
                <Stat k="Last" v={fmtPrice(q.last)} />
                <Stat k="Delta (Δ)" v={fmtDelta(q.greeks?.delta)} />
                <Stat k="Gamma (Γ)" v={fmtGamma(q.greeks?.gamma)} />
                <Stat k="Theta (Θ) / day" v={fmtTheta(q.greeks?.theta)} />
                <Stat k="Vega (ν) / pt" v={fmtVega(q.greeks?.vega)} />
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter className="items-center gap-2 sm:justify-start">
          <Button size="sm" className="bg-buy text-white hover:bg-buy/90" disabled={!q || atLimit} onClick={() => add("buy")} data-testid="option-buy">
            Buy
          </Button>
          <Button size="sm" className="bg-sell text-white hover:bg-sell/90" disabled={!q || atLimit} onClick={() => add("sell")} data-testid="option-sell">
            Sell
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Lots
            <select
              className="h-8 rounded border border-input bg-background px-2 font-mono text-xs text-foreground"
              value={chosen}
              onChange={(e) => setLots(Number(e.target.value))}
              aria-label="Lots"
              data-testid="option-lots"
            >
              {LOT_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="text-2xs text-muted-foreground" data-testid="option-qty">
            {qty !== null && lotSize ? `= ${qty} ${target?.asset ?? ""} (× ${lotSize} per lot)` : ""}
          </span>
          {atLimit ? <span className="text-2xs text-sell">Maximum {MAX_ACTIVE_LEGS} legs</span> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

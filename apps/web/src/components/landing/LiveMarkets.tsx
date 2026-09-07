"use client";
// Live Markets tiles (HC-PB-009): BTC / ETH / XAUT from the gateway `spot:*` topics with a designed
// "Connecting…" state, flash on tick, session H/L and a sparkline from the last ticks.
import { Badge, cn } from "@hapiecoin/ui";
import { UNDERLYINGS, type Underlying } from "@hapiecoin/schema";
import { fmtPct, fmtPrice } from "@/lib/format";
import { useConnectionStatus, useFlash, useSpot } from "@/lib/gateway/hooks";
import { ASSET_META } from "@/lib/store";

export function sparkPath(values: readonly string[], w = 160, h = 36): string {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  return nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Tile({ asset }: { asset: Underlying }) {
  const spot = useSpot(asset);
  const flash = useFlash(spot?.dir ?? null, spot?.updatedAt);
  const meta = ASSET_META[asset];
  const up = (spot?.c24 ?? 0) >= 0;
  return (
    <div
      data-testid={`tile-${asset}`}
      data-state={spot ? "live" : "connecting"}
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-muted font-mono text-sm">{meta.glyph}</div>
          <div>
            <div className="font-mono text-[13px] font-medium">{meta.symbol}</div>
            <div className="text-2xs text-muted-foreground">{meta.name} · perpetual</div>
          </div>
        </div>
        {spot ? (
          <span className={cn("num text-xs", up ? "text-profit" : "text-loss")} data-testid="tile-change">
            {fmtPct(spot.c24)}
          </span>
        ) : (
          <Badge variant="outline">Connecting…</Badge>
        )}
      </div>
      <div className={cn("num mt-3 text-2xl font-medium", flash)} data-testid="tile-price">
        {spot ? fmtPrice(spot.price) : "—"}
      </div>
      <svg viewBox="0 0 160 36" className="mt-2 h-9 w-full" aria-hidden="true">
        {spot ? (
          <path d={sparkPath(spot.history)} fill="none" stroke="hsl(var(--curve))" strokeWidth="1.5" />
        ) : (
          <line x1="0" y1="18" x2="160" y2="18" stroke="hsl(var(--border))" strokeDasharray="3 3" />
        )}
      </svg>
      <div className="mt-2 flex gap-4 font-mono text-2xs text-muted-foreground">
        <span>
          H <span className="text-foreground">{spot ? fmtPrice(spot.high) : "—"}</span>
        </span>
        <span>
          L <span className="text-foreground">{spot ? fmtPrice(spot.low) : "—"}</span>
        </span>
        <span className="ml-auto">USD · Delta India</span>
      </div>
    </div>
  );
}

export function LiveMarkets() {
  const status = useConnectionStatus();
  const live = status === "open";
  return (
    <section id="prices" className="pub-wrap scroll-mt-16 py-16">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="micro">Markets</p>
          <h2 className="mt-1 text-2xl">Live Markets</h2>
          <p className="mt-1 text-muted-foreground">Powered by Delta Exchange</p>
        </div>
        <span
          data-testid="live-badge"
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-2xs uppercase tracking-wide",
            live ? "border-profit/40 text-profit" : "border-border text-muted-foreground",
          )}
        >
          <i className={cn("live-dot", !live && "bg-muted-foreground")} />
          {live ? "Live" : "Connecting…"}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {UNDERLYINGS.map((a) => (
          <Tile key={a} asset={a} />
        ))}
      </div>
    </section>
  );
}

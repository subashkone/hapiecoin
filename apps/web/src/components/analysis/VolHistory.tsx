"use client";
// Vol tab history panels (ADR-056; HC-WS-096, HC-WS-097): IV rank on a 1-year gauge with the interpretation line, and
// realised vs implied with the IV − RV spread, from the API's snapshot history. Honest states while the history is
// still short (days recorded) or absent (the snapshotter has not written yet).
import { type IvHistory, type Underlying, ivRankLabel } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { ApiError } from "@/lib/api/client";
import { useIvHistory } from "@/lib/api/market";
import { fmtExpiry } from "@/lib/format";
import { Chart } from "@/components/analytics/Chart";
import { Panel } from "@/components/analytics/bits";

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

function Waiting({ state, testId }: { state: "loading" | "none" | "error"; testId: string }) {
  return (
    <div className="grid min-h-[140px] place-items-center rounded border border-dashed border-border p-4 text-center text-2xs text-muted-foreground" data-testid={testId} data-state={state}>
      {state === "loading" ? "Loading the IV history…" : state === "none" ? "No history yet · the API records the first snapshot within minutes of starting" : "Could not load the IV history"}
    </div>
  );
}

function stateOf(q: { isLoading: boolean; isError: boolean; error: unknown }): "loading" | "none" | "error" {
  if (q.isLoading) return "loading";
  return q.isError && q.error instanceof ApiError && (q.error.status === 503 || q.error.code === "UNAVAILABLE") ? "none" : "error";
}

export function IvRankPanel({ asset }: { asset: Underlying }) {
  const q = useIvHistory(asset);
  const h: IvHistory | undefined = q.data;
  const rank = h?.rank ?? null;
  const cur = h?.current ?? null;
  return (
    <Panel title="IV rank" sub="1-year range · front expiry ATM IV" testId="panel-iv-rank">
      {!h ? (
        <Waiting state={stateOf(q)} testId="iv-rank-waiting" />
      ) : !rank || !cur ? (
        <div className="min-h-[140px] text-2xs text-muted-foreground" data-testid="iv-rank-short">
          One day of history so far · the rank needs at least two daily points. ATM IV today <b className="num text-foreground">{pct(cur?.atmIv)}</b>.
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="iv-rank" data-rank={Math.round(rank.rank)} data-days={rank.days}>
          <div className="flex items-baseline gap-3">
            <span className="num text-2xl font-medium" data-testid="iv-rank-value">{Math.round(rank.rank)}</span>
            <span className="text-2xs text-muted-foreground">rank · <b className="num text-foreground">{Math.round(rank.percentile)}</b> percentile</span>
            <span className="ml-auto text-2xs text-muted-foreground">now <b className="num text-foreground">{pct(cur.atmIv)}</b> · {fmtExpiry(cur.expiry)}</span>
          </div>
          <div className="relative h-2 rounded bg-muted" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded bg-primary/40" style={{ width: `${rank.rank}%` }} />
            <span className="absolute -top-0.5 h-3 w-0.5 bg-primary" style={{ left: `calc(${rank.rank}% - 1px)` }} />
          </div>
          <div className="flex justify-between font-mono text-2xs text-muted-foreground">
            <span>low {pct(rank.low)}</span>
            <span>{rank.days < 365 ? `${rank.days} of 365 days recorded` : "365 days"}</span>
            <span>high {pct(rank.high)}</span>
          </div>
          <p className={cn("text-2xs", rank.rank >= 80 ? "text-loss" : rank.rank < 20 ? "text-profit" : "text-muted-foreground")} data-testid="iv-rank-label">{ivRankLabel(rank.rank)}</p>
        </div>
      )}
    </Panel>
  );
}

export function RvIvPanel({ asset }: { asset: Underlying }) {
  const q = useIvHistory(asset);
  const h = q.data;
  const rv = h?.realised ?? null;
  const points = h?.series ?? [];
  // rolling 30-day realised vol per day, from the spot closes, for the chart
  const rvSeries = points.map((_, i) => {
    if (i < 2) return null;
    const closes = points.slice(Math.max(0, i - 29), i + 1).map((p) => p.spot);
    let sum = 0;
    const rets: number[] = [];
    for (let j = 1; j < closes.length; j++) rets.push(Math.log(closes[j]! / closes[j - 1]!));
    if (rets.length < 2) return null;
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    for (const r of rets) sum += (r - mean) ** 2;
    return Math.sqrt(sum / (rets.length - 1)) * Math.sqrt(365) * 100;
  });
  return (
    <Panel title="Realised vs implied" sub="30-day realised vol vs ATM IV" testId="panel-rv-iv">
      {!h ? (
        <Waiting state={stateOf(q)} testId="rv-iv-waiting" />
      ) : (
        <div className="flex flex-col gap-2" data-testid="rv-iv" data-days={rv?.days ?? 0}>
          <Chart
            h={140}
            x={points.map((p) => p.day.slice(5))}
            xTip={points.map((p) => p.day)}
            series={[
              { label: "ATM IV", type: "line", data: points.map((p) => p.atmIv * 100), color: "hsl(var(--foreground))", width: 1.4, fmt: (v) => `${v.toFixed(1)}%` },
              { label: "Realised 30d", type: "line", data: rvSeries, color: "hsl(var(--spot))", width: 1.2, fmt: (v) => `${v.toFixed(1)}%` },
            ]}
            yFmt={(v) => `${v.toFixed(0)}%`}
            empty="Waiting for two daily points…"
            testId="chart-rv-iv"
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs" data-testid="rv-iv-readout">
            <span>ATM IV <b className="num">{pct(h.current?.atmIv)}</b></span>
            <span>Realised 30d <b className="num">{pct(rv?.rv30)}</b>{rv && rv.days < 30 ? <span className="text-muted-foreground"> ({rv.days} of 30 closes)</span> : null}</span>
            <span>IV − RV <b className={cn("num", rv ? (rv.spread >= 0 ? "text-loss" : "text-profit") : "")} data-testid="rv-iv-spread">{rv ? `${rv.spread >= 0 ? "+" : ""}${(rv.spread * 100).toFixed(1)} pts` : "—"}</b>{rv ? <span className="text-muted-foreground"> · {rv.spread >= 0 ? "options price more movement than realised" : "realised movement exceeds what options price"}</span> : null}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

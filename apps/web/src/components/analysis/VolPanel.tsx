"use client";
// Vol tab (HC-WS-094..097): the smile of the shown expiry with the strategy's strikes marked, the ATM IV term
// structure across the listed expiries (click switches the expiry), and the two panels that need an IV history
// (IV rank, realised vs implied) as honest placeholders until the snapshotter lands (GAPS #62).
import { expectedMove, smile } from "@hapiecoin/pricing";
import { cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { atmIvOf, skew25, termShape, toPricingRows } from "@/lib/chain/structure";
import { useShownExpiry } from "@/lib/chain/useShownExpiry";
import { daysToExpiry, fmtExpiry, fmtStrike } from "@/lib/format";
import { useChain } from "@/lib/gateway/hooks";
import { useChains } from "@/lib/gateway/useChains";
import { useUiStore } from "@/lib/store";
import { Chart } from "@/components/analytics/Chart";
import { ComingSoon, Panel } from "@/components/analytics/bits";

const ivPct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

export function VolPanel() {
  const { asset, expiries, expiry, legsExpiry, a } = useShownExpiry();
  const setExpiry = useUiStore((s) => s.setExpiry);
  const chain = useChain(asset, expiry);
  const rows = useMemo(() => chain?.rows ?? [], [chain]);
  const spot = a.spot;
  const points = useMemo(() => smile(toPricingRows(rows), spot ?? undefined), [rows, spot]);
  const atmIv = atmIvOf(rows, spot);
  const skew = useMemo(() => skew25(rows), [rows]);
  const dte = expiry ? Math.max(0, daysToExpiry(expiry, new Date(a.nowMs))) : 0;
  const move = spot !== null && atmIv !== null ? expectedMove(spot, atmIv, dte) : null;
  const legStrikes = useMemo(() => new Set(a.legs.filter((l) => l.kind !== "future" && l.expiry === expiry).map((l) => Number(l.strike))), [a.legs, expiry]);
  const chains = useChains(asset, expiries);
  const term = useMemo(() => expiries.map((e) => ({ expiry: e, iv: atmIvOf(chains.get(e)?.rows ?? [], spot) })), [expiries, chains, spot]);
  const shape = termShape(term.map((t) => t.iv));
  const smileLabels = points.map((p, i) => (legStrikes.has(p.strike) ? { i, y: p.iv * 100, text: "●", color: "hsl(var(--spot))" } : null)).filter((x): x is { i: number; y: number; text: string; color: string } => x !== null);
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="vol-panel" data-expiry={expiry ?? ""} data-state={points.length ? "ready" : rows.length ? "empty" : "pending"} data-rows={rows.length}>
      {legsExpiry && legsExpiry !== expiry ? (
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground" data-testid="vol-legs-hint">
          <span>Showing the chain's {expiry ? fmtExpiry(expiry) : "—"}; your strategy's nearest expiry is {fmtExpiry(legsExpiry)}.</span>
          <button type="button" onClick={() => setExpiry(asset, legsExpiry)} className="rounded border border-border px-1.5 py-0.5 hover:text-foreground" data-testid="vol-show-legs-expiry">
            Show {fmtExpiry(legsExpiry)}
          </button>
        </div>
      ) : null}
      <Panel title={`Smile · ${expiry ? `${fmtExpiry(expiry)} · ${dte}d` : "—"}`} sub="mark IV by strike from the live chain · ● the strategy's strikes" testId="panel-smile">
        <Chart
          h={180}
          x={points.map((p) => fmtStrike(String(p.strike)))}
          series={[{ label: "Mark IV", type: "line", data: points.map((p) => p.iv * 100), color: "hsl(var(--foreground))", width: 1.4, fmt: (v) => `${v.toFixed(1)}%` }]}
          labels={smileLabels}
          yFmt={(v) => `${v.toFixed(0)}%`}
          legend={false}
          empty={!expiry ? "No expiry listed" : rows.length ? "No mark IV quoted on this expiry yet" : "Waiting for the chain…"}
          testId="chart-smile"
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs" data-testid="smile-readout">
          <span>ATM IV <b className="num">{ivPct(atmIv)}</b></span>
          <span>25Δ skew <b className="num" data-testid="skew-25">{skew ? `${skew.skewPts >= 0 ? "+" : ""}${skew.skewPts.toFixed(1)} pts` : "—"}</b>{skew ? <span className="text-muted-foreground"> · put {fmtStrike(skew.put.strike)} {ivPct(skew.put.iv)} vs call {fmtStrike(skew.call.strike)} {ivPct(skew.call.iv)}</span> : null}</span>
          <span>Expected move <b className="num">{move === null ? "—" : `±${fmtStrike(String(Math.round(move)))}`}</b>{move !== null && spot ? <span className="text-muted-foreground"> ({((move / spot) * 100).toFixed(1)}%) to expiry</span> : null}</span>
        </div>
      </Panel>
      <Panel title="Term structure" sub="ATM IV by listed expiry · click an expiry to switch the chain" testId="panel-term">
        <Chart
          h={160}
          x={expiries.map((e) => `${fmtExpiry(e)}`)}
          xTip={expiries.map((e) => `${fmtExpiry(e)} · ${Math.max(0, daysToExpiry(e, new Date(a.nowMs)))}d`)}
          series={[{ label: "ATM IV", type: "bar", data: term.map((t) => (t.iv === null ? null : t.iv * 100)), color: "hsl(var(--muted-foreground) / 0.55)", fmt: (v) => `${v.toFixed(1)}%` }]}
          labels={term.map((t, i) => (t.expiry === expiry && t.iv !== null ? { i, y: t.iv * 100, text: "shown", color: "hsl(var(--spot))" } : null)).filter((x): x is { i: number; y: number; text: string; color: string } => x !== null)}
          yFmt={(v) => `${v.toFixed(0)}%`}
          legend={false}
          empty="Waiting for the chains…"
          testId="chart-term"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="term-expiries">
          {term.map((t) => (
            <button key={t.expiry} type="button" aria-pressed={t.expiry === expiry} onClick={() => setExpiry(asset, t.expiry)} className={cn("rounded border px-1.5 py-0.5 text-2xs", t.expiry === expiry ? "border-spot text-spot" : "border-border text-muted-foreground hover:text-foreground")} data-testid="term-expiry" data-expiry={t.expiry}>
              {fmtExpiry(t.expiry)} <span className="num">{ivPct(t.iv)}</span>
            </button>
          ))}
          <span className="micro ml-auto" data-testid="term-shape">{shape ? `${shape}${shape === "contango" ? " · later expiries price more vol" : shape === "backwardation" ? " · the front is the stress" : ""}` : ""}</span>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="IV rank" sub="1-year range" testId="panel-iv-rank">
          <ComingSoon title="IV rank needs an IV history" why="The per-instrument IV snapshotter (GAPS #62) has not landed; until then no 1-year range exists to rank today's IV against." gap={62} />
        </Panel>
        <Panel title="Realised vs implied" sub="30-day realised vol vs ATM IV" testId="panel-rv-iv">
          <ComingSoon title="Realised vol needs price history" why="The 365-day underlying price and IV series arrive with the snapshotter (GAPS #62)." gap={62} />
        </Panel>
      </div>
    </div>
  );
}

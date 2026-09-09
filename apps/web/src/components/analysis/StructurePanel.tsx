"use client";
// Structure tab (HC-WS-098..100): open interest by strike with the max-pain marker, put / call ratios on open
// interest and 24 h volume, and the dealer gamma-exposure profile, all from the live gateway chain of the shown
// expiry (the analytics Options page uses the ingest's venue snapshots instead: a different basis, labelled).
import { gammaExposure, maxPain, putCallRatio } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { usdCompact } from "@/lib/analytics/format";
import { aroundAtm, pcrLabel, toPricingRows } from "@/lib/chain/structure";
import { useShownExpiry } from "@/lib/chain/useShownExpiry";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { useChain } from "@/lib/gateway/hooks";
import { atmIndex } from "@/lib/gateway/reducer";
import { Chart } from "@/components/analytics/Chart";
import { Panel } from "@/components/analytics/bits";

/** Contract value per lot by asset when the settings have not loaded (the same defaults the paper book uses). */
const DEFAULT_LOTS: Record<Underlying, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };

const compact = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0));
const ratio = (v: number) => (Number.isFinite(v) ? v : null);

function PcrTile({ label, calls, puts, value, testId }: { label: string; calls: number; puts: number; value: number | null; testId: string }) {
  const total = calls + puts;
  const callShare = total > 0 ? (calls / total) * 100 : 50;
  return (
    <div className="rounded border border-border p-2" data-testid={testId} data-read={pcrLabel(value)}>
      <div className="flex items-baseline gap-2">
        <span className="micro">{label}</span>
        <b className="num text-lg">{value === null ? "—" : value.toFixed(2)}</b>
        <span className="micro text-muted-foreground">{pcrLabel(value)}</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-muted" title={`calls ${compact(calls)} · puts ${compact(puts)}`}>
        <span style={{ width: `${callShare}%`, background: "hsl(var(--profit) / 0.7)" }} />
        <span style={{ width: `${100 - callShare}%`, background: "hsl(var(--loss) / 0.7)" }} />
      </div>
      <div className="micro mt-1 flex justify-between"><span>calls {compact(calls)}</span><span>puts {compact(puts)}</span></div>
    </div>
  );
}

export function StructurePanel() {
  const { asset, expiry, a } = useShownExpiry();
  const chain = useChain(asset, expiry);
  const rows = useMemo(() => chain?.rows ?? [], [chain]);
  const spot = a.spot;
  const all = useMemo(() => toPricingRows(rows), [rows]);
  const atm = useMemo(() => atmIndex(rows, a.spotText), [rows, a.spotText]);
  const shown = useMemo(() => aroundAtm(all, atm, 12), [all, atm]);
  const mp = all.length ? maxPain(all) : Number.NaN;
  const pcrOi = ratio(putCallRatio(all, "oi"));
  const pcrVol = ratio(putCallRatio(all, "volume"));
  const sums = useMemo(() => all.reduce((s, r) => ({ cOi: s.cOi + (r.callOi ?? 0), pOi: s.pOi + (r.putOi ?? 0), cVol: s.cVol + (r.callVolume ?? 0), pVol: s.pVol + (r.putVolume ?? 0) }), { cOi: 0, pOi: 0, cVol: 0, pVol: 0 }), [all]);
  const contract = Number(a.lotSize ?? DEFAULT_LOTS[asset]) || Number(DEFAULT_LOTS[asset]);
  const gex = useMemo(() => (spot === null ? null : gammaExposure(all, spot, contract)), [all, spot, contract]);
  const gexShown = useMemo(() => (gex ? shown.map((r) => gex.byStrike.find((g) => g.strike === r.strike)?.gex ?? 0) : []), [gex, shown]);
  const mpIndex = shown.findIndex((r) => r.strike === mp);
  const spotIndex = shown.findIndex((r, i) => spot !== null && (i === shown.length - 1 || Number(shown[i + 1]?.strike) > spot) && r.strike <= spot);
  const legStrikes = useMemo(() => new Set(a.legs.filter((l) => l.kind !== "future" && l.expiry === expiry).map((l) => Number(l.strike))), [a.legs, expiry]);
  const labels = [
    ...(mpIndex >= 0 ? [{ i: mpIndex, y: Math.max(shown[mpIndex]?.callOi ?? 0, shown[mpIndex]?.putOi ?? 0), text: `max pain ${fmtStrike(String(mp))}`, color: "hsl(var(--spot))" }] : []),
    ...(spotIndex >= 0 && spotIndex !== mpIndex ? [{ i: spotIndex, y: 0, text: "spot", color: "hsl(var(--spot))" }] : []),
  ];
  const pctFromSpot = spot !== null && Number.isFinite(mp) ? ((mp - spot) / spot) * 100 : null;
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="structure-panel" data-expiry={expiry ?? ""} data-state={all.length ? "ready" : "pending"} data-rows={rows.length} data-max-pain={Number.isFinite(mp) ? mp : undefined}>
      <Panel title={`Max pain · open interest by strike · ${expiry ? fmtExpiry(expiry) : "—"}`} sub="call and put OI per strike from the live chain, ±12 strikes around the money · the strike where the option value paid out at expiry is smallest" testId="panel-oi">
        <Chart
          h={190}
          x={shown.map((r) => fmtStrike(String(r.strike)))}
          xTip={shown.map((r) => `${fmtStrike(String(r.strike))}${legStrikes.has(r.strike) ? " · your strike" : ""}`)}
          series={[
            { label: "Call OI", type: "bar", data: shown.map((r) => r.callOi ?? 0), color: "hsl(var(--profit) / 0.6)", fmt: (v) => compact(v) },
            { label: "Put OI", type: "bar", data: shown.map((r) => r.putOi ?? 0), color: "hsl(var(--loss) / 0.6)", fmt: (v) => compact(v) },
          ]}
          labels={labels}
          yFmt={(v) => compact(v)}
          empty={expiry ? "Waiting for the chain…" : "No expiry listed"}
          testId="chart-oi"
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs" data-testid="max-pain-readout">
          <span>Max pain <b className="num text-spot">{Number.isFinite(mp) ? fmtStrike(String(mp)) : "—"}</b>{pctFromSpot !== null ? <span className="text-muted-foreground"> ({pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(1)}% from spot)</span> : null}</span>
          <span>Σ call OI <b className="num">{compact(sums.cOi)}</b></span>
          <span>Σ put OI <b className="num">{compact(sums.pOi)}</b></span>
          {legStrikes.size ? <span className="text-muted-foreground">your strikes: {[...legStrikes].sort((x, y) => x - y).map((k) => fmtStrike(String(k))).join(", ")}</span> : null}
        </div>
      </Panel>
      <Panel title="Put / call ratio" sub="positioning on all listed strikes of this expiry" testId="panel-pcr">
        <div className="grid gap-2 sm:grid-cols-2">
          <PcrTile label="PCR · open interest" calls={sums.cOi} puts={sums.pOi} value={pcrOi} testId="pcr-oi" />
          <PcrTile label="PCR · 24h volume" calls={sums.cVol} puts={sums.pVol} value={pcrVol} testId="pcr-volume" />
        </div>
      </Panel>
      <Panel title="Gamma exposure" sub={`dealer GEX by strike · Σ Γ × OI × ${contract} × spot² × 1% · calls +, puts −`} testId="panel-gex">
        <Chart
          h={170}
          x={shown.map((r) => fmtStrike(String(r.strike)))}
          series={[{ label: "GEX", type: "bar", data: gexShown, color: "hsl(var(--profit) / 0.65)", colorNeg: "hsl(var(--loss) / 0.65)", fmt: (v) => usdCompact(v) }]}
          zero
          yFmt={(v) => usdCompact(v, 1)}
          legend={false}
          empty={spot === null ? "Waiting for the spot price…" : "Waiting for the chain…"}
          testId="chart-gex"
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs" data-testid="gex-readout">
          <span>net GEX <b className={cn("num", gex && gex.net >= 0 ? "text-profit" : "text-loss")}>{gex ? usdCompact(gex.net) : "—"}</b></span>
          <span>gamma flip <b className="num">{gex?.flipStrike !== null && gex?.flipStrike !== undefined ? fmtStrike(String(gex.flipStrike)) : "none"}</b></span>
          <span className="text-muted-foreground">{gex ? (gex.net >= 0 ? "positive gamma → dealers dampen moves" : "negative gamma → dealers amplify moves") : ""}</span>
        </div>
      </Panel>
      <p className="micro text-muted-foreground">Basis: the live gateway chain of one expiry. The Analytics → Options page reads the ingest's venue snapshots across every expiry, so its max pain can differ.</p>
    </div>
  );
}

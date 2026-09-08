"use client";
// Greeks tab (HC-WS-059..061): net position Greeks at spot, the per-leg breakdown, and one-line meanings.
import { EmptyState, cn } from "@hapiecoin/ui";
import { black76Greeks, yearFraction } from "@hapiecoin/pricing";
import { useMemo } from "react";
import { fmtDelta, fmtExpiry, fmtGamma, fmtIv, fmtStrike, fmtVega } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { Tile } from "./PayoffPanel";

const MEANING: [string, string][] = [
  ["Delta", "How much the position gains for a 1 USD rise in the underlying, in units of the underlying. Positive means long exposure."],
  ["Gamma", "How fast delta changes per 1 USD move. Long options have positive gamma; short options negative."],
  ["Theta", "Time decay per calendar day. Negative theta costs money every day the price does not move."],
  ["Vega", "P&L for a 1 vol-point rise in implied volatility. Long options gain when IV rises."],
];

export function GreeksPanel() {
  const a = useStrategyAnalysis();
  const { legs, result, spot, lotSize, money, asset } = a;
  const g = result?.greeks;
  const rows = useMemo(
    () =>
      legs.map((l) => {
        const sign = (l.side === "buy" ? 1 : -1) * l.lots * Number(lotSize ?? 0);
        if (l.kind === "future") return { leg: l, iv: undefined, greeks: { delta: sign, gamma: 0, theta: 0, vega: 0 } };
        const iv = a.quoteFor(l)?.markIv ?? l.iv;
        if (spot === null || iv === undefined || !lotSize) return { leg: l, iv, greeks: null };
        const T = Math.max(0, yearFraction(a.nowMs, l.expiry, settlementHourUtc(asset)));
        const k = black76Greeks(spot, Number(l.strike), T, iv, l.kind === "call");
        if (!Number.isFinite(k.delta)) return { leg: l, iv, greeks: null };
        return { leg: l, iv, greeks: { delta: k.delta * sign, gamma: k.gamma * sign, theta: k.theta * sign, vega: k.vega * sign } };
      }),
    [legs, lotSize, spot, a, asset],
  );

  if (legs.length === 0) return <EmptyState title="No strategy yet" description="Greeks appear once the strategy has legs." className="py-16" data-testid="greeks-empty" />;

  const tone = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "muted" : v >= 0 ? "profit" : "loss");
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="greeks-panel">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Delta" value={g ? fmtDelta(g.delta) : "—"} sub={`${asset} exposure`} tone={tone(g?.delta)} testId="greek-delta" />
        <Tile label="Gamma" value={g ? fmtGamma(g.gamma) : "—"} sub="per 1 USD move" tone={tone(g?.gamma)} testId="greek-gamma" />
        <Tile label="Theta" value={g ? fmtMoney(g.theta, money, { signed: true }) : "—"} sub="per day" tone={tone(g?.theta)} testId="greek-theta" />
        <Tile label="Vega" value={g ? fmtVega(g.vega) : "—"} sub="per vol point" tone={tone(g?.vega)} testId="greek-vega" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="greeks-table">
          <thead>
            <tr className="micro text-left">
              <th className="py-1 pr-2">Leg</th>
              <th className="py-1 pr-2 text-right">IV</th>
              <th className="py-1 pr-2 text-right">Δ</th>
              <th className="py-1 pr-2 text-right">Γ</th>
              <th className="py-1 pr-2 text-right">Θ/d</th>
              <th className="py-1 text-right">ν</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ leg, iv, greeks }) => (
              <tr key={leg.id} className="border-t border-border" data-testid="greeks-row">
                <td className="py-1.5 pr-2">
                  <span className={cn("mr-1.5 font-mono text-3xs font-bold uppercase", leg.side === "buy" ? "text-buy" : "text-sell")}>{leg.side}</span>
                  <span className="num">{leg.kind === "future" ? leg.symbol : `${fmtStrike(leg.strike)} ${leg.kind === "call" ? "C" : "P"} · ${fmtExpiry(leg.expiry)}`}</span>
                  <span className="micro ml-1.5">× {leg.lots}</span>
                </td>
                <td className="num py-1.5 pr-2 text-right">{leg.kind === "future" ? "—" : fmtIv(iv)}</td>
                <td className={cn("num py-1.5 pr-2 text-right", greeks && greeks.delta < 0 && "text-loss")}>{greeks ? fmtDelta(greeks.delta) : "—"}</td>
                <td className={cn("num py-1.5 pr-2 text-right", greeks && greeks.gamma < 0 && "text-loss")}>{greeks ? fmtGamma(greeks.gamma) : "—"}</td>
                <td className={cn("num py-1.5 pr-2 text-right", greeks && greeks.theta < 0 && "text-loss")}>{greeks ? fmtMoney(greeks.theta, money, { signed: true }) : "—"}</td>
                <td className={cn("num py-1.5 text-right", greeks && greeks.vega < 0 && "text-loss")}>{greeks ? fmtVega(greeks.vega) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">Black-76 on spot, r = 0, live mark IV per leg · position = per-unit greek × lots × lot size ({lotSize ?? "…"} {asset}) · settlement {settlementHourUtc(asset)}:00 UTC</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-2xs sm:grid-cols-2" data-testid="greeks-meaning">
        {MEANING.map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-medium">{k}: </dt>
            <dd className="inline text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

"use client";
// Shared referral pieces (ADR-031): the commission status badge and the earnings-by-month bars used by My Referrals
// (HC-AC-049, HC-AC-067) and the admin Commissions tab (HC-AD-119).
import { COMMISSION_LABELS, type CommissionStatus, type MonthBar } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { fmtInr } from "@/lib/billing/format";

export function StatusBadge({ status }: { status: CommissionStatus }) {
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", status === "paid" ? "border-profit/60 text-profit" : status === "pending" ? "border-warning/60 text-warning" : "border-border text-muted-foreground")} data-testid="ref-status" data-status={status}>
      {COMMISSION_LABELS[status]}
    </span>
  );
}

/** Bars per month: paid solid, pending hatched, so the state reads in shape as well as colour. */
export function EarningsChart({ bars, title = "Earnings by month" }: { bars: readonly MonthBar[]; title?: string }) {
  if (bars.length === 0) return null;
  const max = Math.max(1, ...bars.map((b) => Number(b.paidInr) + Number(b.pendingInr)));
  const w = 36;
  const h = 120;
  const width = Math.max(240, bars.length * (w + 12) + 48);
  return (
    <div className="overflow-x-auto rounded border border-border p-3" data-testid="earnings-chart" data-bars={bars.length}>
      <div className="micro mb-1">{title} · ₹ · paid solid, pending hatched</div>
      <svg width={width} height={h + 28} role="img" aria-label={title}>
        <defs>
          <pattern id="hc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--profit))" strokeWidth="2" />
          </pattern>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={44} x2={width} y1={h - f * h + 4} y2={h - f * h + 4} stroke="hsl(var(--border))" strokeWidth="1" />
            <text x={0} y={h - f * h + 8} className="fill-muted-foreground" fontSize="9" fontFamily="monospace">{Math.round(max * f)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const paid = (Number(b.paidInr) / max) * h;
          const pending = (Number(b.pendingInr) / max) * h;
          const x = 48 + i * (w + 12);
          return (
            <g key={b.month} data-testid="earnings-bar" data-month={b.month}>
              <rect x={x} y={h + 4 - paid} width={w} height={paid} fill="hsl(var(--profit))" />
              <rect x={x} y={h + 4 - paid - pending} width={w} height={pending} fill="url(#hc-hatch)" stroke="hsl(var(--profit))" strokeWidth="1" />
              <text x={x + w / 2} y={h + 22} textAnchor="middle" className="fill-muted-foreground" fontSize="9" fontFamily="monospace">{b.month.slice(2)}</text>
              <title>{`${b.month}: paid ${fmtInr(b.paidInr, { decimals: true })}, pending ${fmtInr(b.pendingInr, { decimals: true })}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

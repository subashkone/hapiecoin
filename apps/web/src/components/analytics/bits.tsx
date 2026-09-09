"use client";
// Small analytics building blocks (HC-MA-011, 104, 106): stat tile, panel, source line, heat cell, long/short split,
// coin cell, compact arc gauge, treemap and the "coming soon" panel for datasets behind paid sources (GAPS #55).
import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import { Badge, cn } from "@hapiecoin/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { ago, fearGreedTone, heatAlpha, pct, toneClass, usdCompact } from "@/lib/analytics/format";

export function Tile({ label, value, sub, extra, tone, testId, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; extra?: ReactNode; tone?: "profit" | "loss" | "warning" | "muted"; testId?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-md border border-border bg-card px-3 py-2.5", className)} data-testid={testId}>
      <div className="micro truncate">{label}</div>
      <div className={cn("num mt-0.5 truncate text-[18px] font-medium leading-tight", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "warning" && "text-warning", tone === "muted" && "text-muted-foreground")}>{value}</div>
      {sub !== undefined ? <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">{sub}</div> : null}
      {extra}
    </div>
  );
}

export function Panel({ title, sub, tools, children, className, testId }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-card", className)} data-testid={testId}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h3 className="text-[13px] font-medium">{title}</h3>
        {sub ? <span className="text-2xs text-muted-foreground">· {sub}</span> : null}
        {tools ? <div className="ml-auto flex items-center gap-2">{tools}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** "Binance · OKX · as of 20s ago · stale" under every chart and table (ADR-038). */
export function SourceLine({ snapshot, className }: { snapshot: Pick<AnalyticsSnapshot, "source" | "asOf" | "stale"> | undefined; className?: string }) {
  if (!snapshot) return null;
  return (
    <div className={cn("micro mt-2 flex flex-wrap items-center gap-2", className)} data-testid="source-line" data-stale={snapshot.stale}>
      <span>{snapshot.source}</span>
      <span>· as of {ago(snapshot.asOf)}</span>
      {snapshot.stale ? <Badge variant="warning">stale</Badge> : null}
    </div>
  );
}

export function Heat({ v, max = 5, fraction = false, digits = 2 }: { v: number | null | undefined; max?: number; fraction?: boolean; digits?: number }) {
  const shown = fraction && v !== null && v !== undefined ? v * 100 : v;
  return (
    <span className={cn("num inline-block rounded px-1.5 py-0.5", toneClass(shown))} style={{ background: shown ? `hsl(var(${shown > 0 ? "--profit" : "--loss"}) / ${heatAlpha(shown, max).toFixed(2)})` : undefined }} data-testid="heat-cell">
      {pct(shown, digits)}
    </span>
  );
}

export function Split({ long, short }: { long: number; short: number }) {
  const t = long + short || 1;
  return (
    <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded" data-testid="split">
      <i className="bg-profit" style={{ width: `${((long / t) * 100).toFixed(1)}%` }} />
      <i className="bg-loss" style={{ width: `${((short / t) * 100).toFixed(1)}%` }} />
    </span>
  );
}

export function Coin({ symbol, name, rank }: { symbol: string; name?: string | undefined; rank?: number | undefined }) {
  return (
    <span className="inline-flex items-center gap-2">
      {rank !== undefined ? <span className="num w-5 text-right text-2xs text-muted-foreground">{rank}</span> : null}
      <span className="grid size-6 place-items-center rounded-full bg-muted font-mono text-[10px] font-medium">{symbol.slice(0, 3)}</span>
      <b>{symbol}</b>
      {name ? <small className="truncate text-muted-foreground">{name}</small> : null}
    </span>
  );
}

/** Compact half-circle gauge with the amber needle (HC-MA-104, 106). */
export function Gauge({ value, size = 92, thick = 8, label, segs, testId }: { value: number; size?: number; thick?: number; label?: string; segs?: [number, number, string][]; testId?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - thick / 2 - 3;
  const cx = size / 2;
  const cy = size / 2 + 3;
  const ang = (t: number) => Math.PI + (t / 100) * Math.PI;
  const pt = (t: number, rr: number) => [cx + rr * Math.cos(ang(t)), cy + rr * Math.sin(ang(t))] as const;
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a, r);
    const [x2, y2] = pt(b, r);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${b - a > 50 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const segments = segs ?? [[0, 25, "hsl(var(--loss) / 0.8)"], [25, 45, "hsl(var(--warning) / 0.65)"], [45, 55, "hsl(var(--muted-foreground) / 0.45)"], [55, 75, "hsl(var(--profit) / 0.5)"], [75, 100, "hsl(var(--profit) / 0.9)"]];
  const [nx, ny] = pt(v, r - thick / 2 - 2);
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 10}`} style={{ width: size, height: size / 2 + 10 }} role="img" aria-label={`${label ?? "gauge"} ${Math.round(v)}`} data-testid={testId ?? "gauge"} data-value={Math.round(v)}>
      {segments.map(([a, b, c]) => (
        <path key={`${a}-${b}`} d={arc(a, b)} fill="none" stroke={c} strokeWidth={thick} strokeLinecap="butt" />
      ))}
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="hsl(var(--primary))" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3" fill="hsl(var(--primary))" />
      <text x={cx} y={cy - 8} textAnchor="middle" className={cn("num font-medium", `text-${fearGreedTone(v)}`)} style={{ fontSize: size * 0.19 }} fill="currentColor">{Math.round(v)}</text>
    </svg>
  );
}

/** Squarified treemap of market caps coloured by 24 h change (HC-MA-028, 035). */
export function Treemap({ items, h = 300, testId }: { items: { symbol: string; marketCap: number; change24h: number | null }[]; h?: number; testId?: string }) {
  const total = items.reduce((s, i) => s + i.marketCap, 0);
  const rects: { symbol: string; change24h: number | null; x: number; y: number; w: number; hh: number }[] = [];
  const W = 100;
  // slice-and-dice by rows: a simple, deterministic layout that keeps big caps readable
  let y = 0;
  let idx = 0;
  const sorted = [...items].sort((a, b) => b.marketCap - a.marketCap);
  while (idx < sorted.length && total > 0) {
    let rowCap = 0;
    const row: typeof sorted = [];
    const target = Math.max(0.12, (sorted[idx]?.marketCap ?? 0) / total);
    while (idx < sorted.length && (row.length === 0 || rowCap / total < target)) {
      row.push(sorted[idx]!);
      rowCap += sorted[idx]!.marketCap;
      idx += 1;
    }
    const rowH = (rowCap / total) * 100;
    let x = 0;
    for (const it of row) {
      const w = (it.marketCap / rowCap) * W;
      rects.push({ symbol: it.symbol, change24h: it.change24h, x, y, w, hh: rowH });
      x += w;
    }
    y += rowH;
  }
  return (
    <div className="relative w-full overflow-hidden rounded" style={{ height: h }} data-testid={testId ?? "treemap"} data-count={rects.length}>
      {rects.map((r) => (
        <div key={r.symbol} className="absolute overflow-hidden border border-background p-1 font-mono text-[10px]" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.hh}%`, background: `hsl(var(${(r.change24h ?? 0) >= 0 ? "--profit" : "--loss"}) / ${(0.15 + heatAlpha(r.change24h, 8)).toFixed(2)})` }} title={`${r.symbol} ${pct(r.change24h)}`}>
          <b>{r.symbol}</b>
          {r.w > 9 && r.hh > 8 ? <div className={toneClass(r.change24h)}>{pct(r.change24h)}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function ComingSoon({ title, why, gap = 55 }: { title: string; why: string; gap?: number }) {
  return (
    <div className="grid min-h-[140px] place-items-center rounded border border-dashed border-border p-4 text-center" data-testid="coming-soon">
      <div>
        <b className="text-[13px]">{title}</b>
        <div className="mt-1 max-w-[42ch] text-2xs text-muted-foreground">{why}</div>
        <div className="micro mt-2">Coming soon · GAPS #{gap}</div>
      </div>
    </div>
  );
}

export const usd = usdCompact;
export function ViewAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-2xs text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

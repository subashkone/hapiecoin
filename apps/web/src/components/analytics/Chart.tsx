"use client";
// Inline-SVG chart for the analytics pages (HC-MA-009, 010, 093..098): line / area / bars (grouped or stacked), dual
// axis, toggleable legend, timeframe chips, crosshair tooltip with every series value, last-value tags at the right
// edge, faint horizontal grid with 10.5 px mono axis labels, a loading skeleton and an empty state.
import { cn } from "@hapiecoin/ui";
import { useMemo, useRef, useState } from "react";
import { type ChartSpec, indexAt, layoutChart } from "@/lib/analytics/chart";
import type { Timeframe } from "@/lib/analytics/format";
import { Chips } from "./Chips";

export interface ChartProps extends ChartSpec {
  loading?: boolean;
  empty?: string;
  tf?: { options?: readonly Timeframe[]; value: Timeframe; onChange: (tf: Timeframe) => void };
  legend?: boolean;
  aria?: string;
  testId?: string;
}

export function Chart(p: ChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const layout = useMemo(() => layoutChart({ ...p, w: width }, hidden), [p, width, hidden]);
  const h = p.h ?? 220;
  const legendItems = p.legend === false ? [] : p.series.filter((s) => s.data.length > 0);
  const shownCount = p.series.filter((s) => s.data.length > 0 && !hidden.has(s.label)).length;
  const measure = (el: HTMLDivElement | null) => {
    hostRef.current = el;
    if (el && el.clientWidth > 0 && el.clientWidth !== width) setWidth(el.clientWidth);
  };
  const toggle = (label: string) =>
    setHidden((s) => {
      const next = new Set(s);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(indexAt(layout, ((e.clientX - r.left) * layout.w) / Math.max(1, r.width)));
  };
  const tip = hover !== null ? p.series.filter((s) => !hidden.has(s.label) && s.data[hover] !== null && s.data[hover] !== undefined) : [];

  return (
    <div ref={measure} className="relative" data-testid={p.testId ?? "chart"} data-hidden={[...hidden].join(",")} data-state={p.loading ? "loading" : layout.paths.length + layout.bars.length === 0 ? "empty" : "ready"}>
      {(legendItems.length > 0 || p.tf) && (
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs" data-testid="chart-legend">
            {legendItems.map((s, i) => (
              <button key={s.label} type="button" onClick={() => toggle(s.label)} className={cn("inline-flex items-center gap-1.5", hidden.has(s.label) && "line-through opacity-50")} title={`Toggle ${s.label}`} data-testid="legend-item" data-on={!hidden.has(s.label)}>
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color ?? ["hsl(var(--foreground))", "hsl(var(--curve))", "hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--profit))", "hsl(var(--loss))"][i % 6] }} aria-hidden="true" />
                {s.label}
              </button>
            ))}
          </div>
          {p.tf ? <Chips className="ml-auto" items={p.tf.options ?? ["1D", "7D", "30D", "90D", "1Y"]} value={p.tf.value} onChange={p.tf.onChange} testId="chart-tf" /> : null}
        </div>
      )}
      {p.loading ? (
        <div className="skeleton rounded" style={{ height: h }} data-testid="chart-skeleton" />
      ) : shownCount === 0 || layout.paths.length + layout.bars.length === 0 ? (
        <div className="grid place-items-center text-xs text-muted-foreground" style={{ minHeight: Math.round(h * 0.6) }} data-testid="chart-empty">
          {legendItems.length > 0 && shownCount === 0 ? "All series are hidden. Click a legend item to show it again." : (p.empty ?? "Nothing to plot for this range")}
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${layout.w} ${h}`} style={{ width: "100%", height: h }} role="img" aria-label={p.aria ?? p.series.map((s) => s.label).join(", ")} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="font-mono text-[10.5px]">
            <defs>
              {layout.paths.filter((x) => x.area).map((x) => (
                <linearGradient key={x.key} id={`g-${x.key.replace(/\W+/g, "-")}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" style={{ stopColor: x.color, stopOpacity: 0.22 }} />
                  <stop offset="1" style={{ stopColor: x.color, stopOpacity: 0.02 }} />
                </linearGradient>
              ))}
            </defs>
            {layout.bandRects.map((b, i) => (
              <rect key={`b${i}`} x={layout.pad.l} y={b.y} width={layout.w - layout.pad.l - layout.pad.r} height={b.h} fill={b.color} data-testid="chart-band" />
            ))}
            {layout.regionPaths.map((r) => (
              <path key={r.key} d={r.d} fill={r.color} opacity="0.28" data-testid="chart-region">
                <title>{r.key}</title>
              </path>
            ))}
            {layout.ticksL.map((v) => (
              <g key={`l${v}`}>
                <line x1={layout.pad.l} x2={layout.w - layout.pad.r} y1={layout.sy(v)} y2={layout.sy(v)} stroke="hsl(var(--border))" strokeDasharray="1 3" />
                <text x={layout.pad.l - 6} y={layout.sy(v) + 3.5} textAnchor="end" fill="hsl(var(--muted-foreground))">{(p.yFmt ?? String)(v)}</text>
              </g>
            ))}
            {layout.ticksR.map((v) => (
              <text key={`r${v}`} x={layout.w - layout.pad.r + 6} y={layout.sy(v, "r") + 3.5} fill="hsl(var(--muted-foreground))">{(p.y2Fmt ?? p.yFmt ?? String)(v)}</text>
            ))}
            {layout.xTicks.map((t) => (
              <text key={t.i} x={layout.sx(t.i)} y={h - 6} textAnchor={t.i === 0 ? "start" : "middle"} fill="hsl(var(--muted-foreground))">{t.label}</text>
            ))}
            {layout.hlines.map((l, i) => (
              <g key={i}>
                <line x1={layout.pad.l} x2={layout.w - layout.pad.r} y1={l.y} y2={l.y} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" />
                {l.label ? <text x={layout.pad.l + 4} y={l.y - 4} fill="hsl(var(--muted-foreground))">{l.label}</text> : null}
              </g>
            ))}
            {layout.bars.map((b) => (
              <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} opacity={hover === null || hover === b.i ? 0.85 : 0.45} />
            ))}
            {layout.paths.map((x) => (
              <g key={x.key}>
                {x.area ? <path d={x.area} fill={`url(#g-${x.key.replace(/\W+/g, "-")})`} /> : null}
                <path d={x.d} fill="none" stroke={x.color} strokeWidth={x.width} strokeDasharray={x.dash} strokeLinejoin="round" strokeLinecap="round" />
                {x.last ? <circle cx={x.last.x} cy={x.last.y} r="2.6" fill={x.color} /> : null}
              </g>
            ))}
            {layout.labelPos.map((l, i) => (
              <text key={`lb${i}`} x={l.x} y={l.y} textAnchor="middle" fill={l.color ?? "hsl(var(--primary))"} className="font-medium" data-testid="chart-label">{l.text}</text>
            ))}
            {layout.tags.map((t) => (
              <g key={t.label} transform={`translate(${layout.w - layout.pad.r + 3},${t.y})`}>
                <rect x="0" y="-8" width={t.text.length * 6.4 + 8} height="16" rx="2" fill={t.color} />
                <text x="4" y="3.5" fill="hsl(var(--background))" className="font-medium">{t.text}</text>
              </g>
            ))}
            {hover !== null ? <line x1={layout.sx(hover)} x2={layout.sx(hover)} y1={layout.pad.t} y2={h - layout.pad.b} stroke="hsl(var(--foreground))" opacity="0.45" /> : null}
            {hover !== null
              ? layout.paths.map((x) => {
                  const s = p.series.find((q) => q.label === x.key);
                  const v = s?.data[hover];
                  return v === null || v === undefined ? null : <circle key={x.key} cx={layout.sx(hover)} cy={layout.sy(v, s?.axis)} r="3.2" fill={x.color} stroke="hsl(var(--card))" strokeWidth="1.5" />;
                })
              : null}
          </svg>
          {hover !== null && tip.length > 0 ? (
            <div className="pointer-events-none absolute top-2 rounded border border-border bg-popover px-2 py-1.5 text-2xs shadow-md" style={{ left: `${Math.min(88, (layout.sx(hover) / layout.w) * 100 + 2)}%` }} data-testid="chart-tip">
              <div className="micro">{(p.xTip ?? p.x)[hover]}</div>
              {tip.map((s) => (
                <div key={s.label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{s.label}</span>
                  <b className="num">{(s.fmt ?? ((s.axis ?? "l") === "r" ? (p.y2Fmt ?? p.yFmt) : p.yFmt) ?? String)(s.data[hover] as number)}</b>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

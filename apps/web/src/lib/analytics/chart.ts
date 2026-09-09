// Pure layout for the analytics SVG chart (HC-MA-009, 093..098): scales, ticks, paths and bar rects from a spec.
// Kept free of React so it is unit-tested directly and the component only renders what this returns.

export type SeriesType = "line" | "area" | "bar";
export interface ChartSeries {
  label: string;
  data: (number | null)[];
  type?: SeriesType;
  /** CSS colour; defaults by slot. */
  color?: string;
  /** Bar colour for values below zero (funding, basis). */
  colorNeg?: string;
  axis?: "l" | "r";
  /** Value formatter for the tooltip and tags. */
  fmt?: (v: number) => string;
  width?: number;
  dash?: string;
}
export interface ChartSpec {
  series: ChartSeries[];
  /** X labels per point (same length as the longest series). */
  x: string[];
  xTip?: string[];
  w?: number;
  h?: number;
  stack?: boolean;
  rightAxis?: boolean;
  yFmt?: (v: number) => string;
  y2Fmt?: (v: number) => string;
  /** Include zero on the left axis. */
  zero?: boolean;
  /** No 7 % padding on the y range. */
  tight?: boolean;
  hlines?: { y: number; axis?: "l" | "r"; label?: string }[];
  /** Target number of y ticks (default 4); use 1 for sparklines. */
  yTicks?: number;
  min?: number;
  max?: number;
  /** Logarithmic left axis (cycle charts); values ≤ 0 are skipped. */
  logY?: boolean;
  /** Horizontal fills on the left axis (Fear & Greed zones). */
  bands?: { from: number; to: number; color: string; label?: string }[];
  /** Fills between two series on the left axis (rainbow bands); drawn under the lines. */
  regions?: { label: string; lower: (number | null)[]; upper: (number | null)[]; color: string }[];
  /** Free text anchored at a data index and left-axis value (max-pain per expiry). */
  labels?: { i: number; y: number; text: string; color?: string }[];
}
export interface Extent {
  lo: number;
  hi: number;
}
export interface Layout {
  w: number;
  h: number;
  pad: { t: number; r: number; b: number; l: number };
  n: number;
  hasBars: boolean;
  sx: (i: number) => number;
  sy: (v: number, axis?: "l" | "r") => number;
  yl: Extent;
  yr: Extent | null;
  ticksL: number[];
  ticksR: number[];
  xTicks: { i: number; label: string }[];
  paths: { key: string; d: string; area: string | null; color: string; width: number; dash: string | undefined; last: { x: number; y: number; v: number } | null }[];
  bars: { key: string; x: number; y: number; w: number; h: number; color: string; i: number }[];
  tags: { label: string; y: number; color: string; text: string }[];
  hlines: { y: number; label: string | undefined }[];
  bandRects: { y: number; h: number; color: string; label: string | undefined }[];
  regionPaths: { key: string; d: string; color: string }[];
  labelPos: { x: number; y: number; text: string; color: string | undefined }[];
}

export const SLOT_COLORS = ["hsl(var(--foreground))", "hsl(var(--curve))", "hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--profit))", "hsl(var(--loss))"];
export const colorFor = (i: number): string => SLOT_COLORS[i % SLOT_COLORS.length]!;

/** Round tick values covering [lo, hi] with about `n` steps. */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** 1-2-5 × 10^k ticks inside [lo, hi] for a log axis (both positive). */
export function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi > lo)) return [];
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) for (const m of [1, 2, 5]) {
    const v = m * 10 ** k;
    if (v >= lo && v <= hi) out.push(v);
  }
  return out;
}

function extent(spec: ChartSpec, series: ChartSeries[], axis: "l" | "r", n: number): Extent | null {
  let lo = Infinity;
  let hi = -Infinity;
  const add = (v: number) => {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  const ax = series.filter((s) => (s.axis ?? "l") === axis);
  const lines = (spec.hlines ?? []).filter((l) => (l.axis ?? "l") === axis);
  const regions = axis === "l" ? (spec.regions ?? []) : [];
  if (!ax.length && !lines.length && !regions.length) return null;
  const usable = (v: number | null | undefined): v is number => finite(v) && (!spec.logY || axis !== "l" || v > 0);
  if (spec.stack) {
    const bars = ax.filter((s) => s.type === "bar");
    for (let i = 0; i < n; i++) {
      let p = 0;
      let q = 0;
      for (const s of bars) {
        const v = s.data[i];
        if (!finite(v)) continue;
        if (v >= 0) p += v;
        else q += v;
      }
      add(p);
      add(q);
    }
    for (const s of ax.filter((b) => b.type !== "bar")) for (const v of s.data) if (usable(v)) add(v);
  } else {
    for (const s of ax) for (const v of s.data) if (usable(v)) add(v);
  }
  for (const r of regions) for (const v of [...r.lower, ...r.upper]) if (usable(v)) add(v);
  for (const l of lines) add(l.y);
  if (!Number.isFinite(lo)) return null;
  if (ax.some((s) => s.type === "bar") || (axis === "l" && spec.zero)) add(0);
  if (axis === "l" && spec.min !== undefined) lo = Math.min(lo, spec.min);
  if (axis === "l" && spec.max !== undefined) hi = Math.max(hi, spec.max);
  if (lo === hi) {
    lo -= Math.abs(lo || 1) * 0.1;
    hi += Math.abs(hi || 1) * 0.1;
  }
  const r = hi - lo;
  const padF = spec.tight ? 0 : 0.07;
  if (axis === "l" && spec.logY && lo > 0) {
    const f = (hi / lo) ** padF; // pad in log space so the floor never crosses zero
    return { lo: lo / f, hi: hi * f };
  }
  return { lo: lo === 0 || (axis === "l" && spec.min !== undefined) ? lo : lo - r * padF, hi: hi === 0 || (axis === "l" && spec.max !== undefined) ? hi : hi + r * padF };
}

export function layoutChart(spec: ChartSpec, hidden: ReadonlySet<string> = new Set()): Layout {
  const w = spec.w ?? 720;
  const h = spec.h ?? 220;
  const all = spec.series.filter((s) => s.data.length > 0);
  const shown = all.filter((s) => !hidden.has(s.label));
  const yFmt = spec.yFmt ?? ((v: number) => String(v));
  const y2Fmt = spec.y2Fmt ?? yFmt;
  const fmtOf = (s: ChartSeries) => s.fmt ?? ((s.axis ?? "l") === "r" ? y2Fmt : yFmt);
  const n = Math.max(1, ...shown.map((s) => s.data.length));
  const hasBars = shown.some((s) => s.type === "bar");
  const tagSeries = shown.filter((s) => s.type !== "bar").slice(0, 3);
  const pad = { t: 12, r: spec.rightAxis ? 54 : 12, b: 22, l: 50 };
  let maxTag = 0;
  for (const s of tagSeries) {
    const last = [...s.data].reverse().find(finite);
    if (last !== undefined) maxTag = Math.max(maxTag, fmtOf(s)(last).length * 6.4 + 10);
  }
  if (maxTag) pad.r = Math.max(pad.r, Math.round(maxTag) + 4);
  const pw = Math.max(1, w - pad.l - pad.r);
  const ph = Math.max(1, h - pad.t - pad.b);
  const yl = extent(spec, shown, "l", n) ?? { lo: 0, hi: 1 };
  const yr = spec.rightAxis ? extent(spec, shown, "r", n) : null;
  const logL = spec.logY === true && yl.lo > 0;
  const tr = (v: number, log: boolean) => (log ? Math.log10(v) : v);
  const sy = (v: number, axis: "l" | "r" = "l"): number => {
    const e = axis === "r" ? (yr ?? yl) : yl;
    const log = axis === "l" && logL;
    if (log && !(v > 0)) return pad.t + ph;
    return pad.t + ph - ((tr(v, log) - tr(e.lo, log)) / (tr(e.hi, log) - tr(e.lo, log) || 1)) * ph;
  };
  const slot = pw / n;
  const sx = (i: number): number => (hasBars ? pad.l + slot * (i + 0.5) : pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw));
  const nTicks = spec.yTicks ?? 4;
  const ticksL = logL ? logTicks(yl.lo, yl.hi) : niceTicks(yl.lo, yl.hi, nTicks).filter((v) => v >= yl.lo && v <= yl.hi);
  const ticksR = yr ? niceTicks(yr.lo, yr.hi, nTicks).filter((v) => v >= yr.lo && v <= yr.hi) : [];
  const xstep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 100))));
  const xTicks: Layout["xTicks"] = [];
  for (let i = 0; i < n; i += xstep) {
    const label = spec.x[i];
    if (label !== undefined) xTicks.push({ i, label });
  }
  const barSeries = shown.filter((s) => s.type === "bar");
  const groupN = spec.stack ? 1 : barSeries.length;
  const gw = slot * 0.72;
  const bw = Math.max(1, gw / (groupN || 1));
  const stackPos = new Array<number>(n).fill(0);
  const stackNeg = new Array<number>(n).fill(0);
  const bars: Layout["bars"] = [];
  barSeries.forEach((s, si) => {
    const color = s.color ?? colorFor(spec.series.indexOf(s));
    for (let i = 0; i < n; i++) {
      const v = s.data[i];
      if (!finite(v)) continue;
      let base = 0;
      if (spec.stack) {
        if (v >= 0) {
          base = stackPos[i] ?? 0;
          stackPos[i] = base + v;
        } else {
          base = stackNeg[i] ?? 0;
          stackNeg[i] = base + v;
        }
      }
      const y1 = sy(base + v, s.axis);
      const y0 = sy(base, s.axis);
      const x = sx(i) - gw / 2 + (spec.stack ? 0 : si * bw);
      bars.push({ key: `${s.label}-${i}`, x, y: Math.min(y0, y1), w: bw, h: Math.max(1, Math.abs(y0 - y1)), color: v < 0 && s.colorNeg ? s.colorNeg : color, i });
    }
  });
  const paths: Layout["paths"] = [];
  const plottable = (v: number | null | undefined, axis: "l" | "r" | undefined): v is number => finite(v) && (!(logL && (axis ?? "l") === "l") || v > 0);
  for (const s of shown.filter((b) => b.type !== "bar")) {
    let d = "";
    let started = false;
    let first = -1;
    let last = -1;
    s.data.forEach((v, i) => {
      if (!plottable(v, s.axis)) {
        started = false;
        return;
      }
      if (first < 0) first = i;
      last = i;
      d += `${started ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v, s.axis).toFixed(1)} `;
      started = true;
    });
    if (last < 0) continue;
    const lastV = s.data[last] as number;
    const base = sy(Math.max(yl.lo, Math.min(yl.hi, logL ? yl.lo : 0)), s.axis).toFixed(1);
    const area = s.type === "area" ? `${d}L${sx(last).toFixed(1)} ${base} L${sx(first).toFixed(1)} ${base} Z` : null;
    paths.push({ key: s.label, d: d.trim(), area, color: s.color ?? colorFor(spec.series.indexOf(s)), width: s.width ?? 1.5, dash: s.dash, last: { x: sx(last), y: sy(lastV, s.axis), v: lastV } });
  }
  const placed: number[] = [];
  const tags: Layout["tags"] = [];
  for (const s of tagSeries) {
    const p = paths.find((x) => x.key === s.label);
    if (!p?.last) continue;
    let y = p.last.y;
    for (const py of placed) if (Math.abs(py - y) < 16) y = py + (y >= py ? 16 : -16);
    y = Math.max(pad.t + 8, Math.min(pad.t + ph - 8, y));
    placed.push(y);
    tags.push({ label: s.label, y, color: p.color, text: fmtOf(s)(p.last.v) });
  }
  const hlines = (spec.hlines ?? []).map((l) => ({ y: sy(l.y, l.axis), label: l.label }));
  const clampY = (v: number) => Math.max(pad.t, Math.min(pad.t + ph, sy(Math.max(yl.lo, Math.min(yl.hi, v)))));
  const bandRects = (spec.bands ?? []).map((b) => {
    const y0 = clampY(b.to);
    const y1 = clampY(b.from);
    return { y: y0, h: Math.max(0, y1 - y0), color: b.color, label: b.label };
  });
  const regionPaths: Layout["regionPaths"] = [];
  for (const r of spec.regions ?? []) {
    const idx = r.lower.map((_, i) => i).filter((i) => plottable(r.lower[i], "l") && plottable(r.upper[i], "l"));
    if (idx.length < 2) continue;
    const top = idx.map((i, k) => `${k === 0 ? "M" : "L"}${sx(i).toFixed(1)} ${sy(r.upper[i] as number).toFixed(1)}`).join(" ");
    const bottom = [...idx].reverse().map((i) => `L${sx(i).toFixed(1)} ${sy(r.lower[i] as number).toFixed(1)}`).join(" ");
    regionPaths.push({ key: r.label, d: `${top} ${bottom} Z`, color: r.color });
  }
  const labelPos = (spec.labels ?? []).filter((l) => l.i >= 0 && l.i < n).map((l) => ({ x: sx(l.i), y: Math.max(pad.t + 8, sy(l.y) - 6), text: l.text, color: l.color }));
  return { w, h, pad, n, hasBars, sx, sy, yl, yr, ticksL, ticksR, xTicks, paths, bars, tags, hlines, bandRects, regionPaths, labelPos };
}

/** Nearest data index for a pointer x in SVG units. */
export function indexAt(layout: Layout, mx: number): number {
  const pw = layout.w - layout.pad.l - layout.pad.r;
  const raw = layout.hasBars ? Math.floor((mx - layout.pad.l) / (pw / layout.n)) : Math.round(((mx - layout.pad.l) / pw) * (layout.n - 1));
  return Math.max(0, Math.min(layout.n - 1, raw));
}

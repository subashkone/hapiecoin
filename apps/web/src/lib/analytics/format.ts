// Formatting for the analytics pages (HC-MA-011, 037): compact USD, prices by magnitude, signed percents, heat classes.
import type { SeriesPoint } from "@hapiecoin/schema";

export function usdCompact(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits)}K`;
  return `${sign}$${a.toFixed(digits)}`;
}
export function signedUsdCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "-"}${usdCompact(Math.abs(v))}`;
}
/** Prices: 2 dp above $1000, 3 dp above $1, up to 7 significant below. */
export function price(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(p >= 100 ? 2 : 3)}`;
  return `$${p.toFixed(p >= 0.01 ? 4 : 7).replace(/0+$/, "").replace(/\.$/, "")}`;
}
/** "+1.23%" / "-0.45%"; `v` is already a percent (CoinGecko) unless `fraction` is set. */
export function pct(v: number | null | undefined, digits = 2, fraction = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = fraction ? v * 100 : v;
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}
export const tone = (v: number | null | undefined): "up" | "down" | "flat" => (v === null || v === undefined || !Number.isFinite(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");
export const toneClass = (v: number | null | undefined): string => ({ up: "text-profit", down: "text-loss", flat: "text-muted-foreground" })[tone(v)];
/** Background alpha for a heat cell, 0..1 against `max` percent. */
export function heatAlpha(v: number | null | undefined, max = 5): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  return Math.min(Math.abs(v) / max, 1) * 0.35;
}
export function fearGreedTone(v: number): "loss" | "warning" | "muted" | "profit" {
  return v < 25 ? "loss" : v < 45 ? "warning" : v < 55 ? "muted" : "profit";
}
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export type Timeframe = "1D" | "7D" | "30D" | "90D" | "1Y";
export const TIMEFRAMES: readonly Timeframe[] = ["1D", "7D", "30D", "90D", "1Y"];
const TF_MS: Record<Timeframe, number> = { "1D": 864e5, "7D": 7 * 864e5, "30D": 30 * 864e5, "90D": 90 * 864e5, "1Y": 365 * 864e5 };
const MAX_POINTS = 120;

const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
const my = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

/** Cut a series to the timeframe, thin it to ≤ 120 points, and label the x axis by span. */
export function sliceSeries(points: readonly SeriesPoint[], tf: Timeframe, now = Date.now()): { values: number[]; x: string[]; xTip: string[]; covered: boolean } {
  const from = now - TF_MS[tf];
  const inRange = points.filter((p) => p.t >= from);
  const covered = points.length > 0 && (points[0]?.t ?? now) <= from;
  const step = inRange.length > MAX_POINTS ? (inRange.length - 1) / (MAX_POINTS - 1) : 1;
  const picked: SeriesPoint[] = [];
  if (inRange.length > MAX_POINTS) for (let i = 0; i < MAX_POINTS; i++) picked.push(inRange[Math.round(i * step)]!);
  else picked.push(...inRange);
  const span = tf === "1D" ? "hm" : tf === "1Y" ? "my" : "md";
  return {
    values: picked.map((p) => p.v),
    x: picked.map((p) => (span === "hm" ? hm(new Date(p.t)) : span === "my" ? my(new Date(p.t)) : md(new Date(p.t)))),
    xTip: picked.map((p) => `${md(new Date(p.t))} ${hm(new Date(p.t))}`),
    covered,
  };
}

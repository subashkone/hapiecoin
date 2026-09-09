// Public payoff chart preview (HC-PB-042..051, 063, 064; ADR-037): fixed presets priced by the same engine the
// workspace uses, entirely in the browser. No market data, no account: one contract = 1 BTC so the numbers read
// like a trader's own position. Open interest is a deterministic shape around spot (the public page has no chain).
import { type AnalyzeResult, type Leg, MS_PER_DAY, analyze } from "@hapiecoin/pricing";

export interface PreviewLeg {
  kind: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  /** Premium per BTC. */
  price: number;
  /** IV in percent. */
  iv: number;
}
export interface Preset {
  name: string;
  spot: number;
  legs: readonly PreviewLeg[];
  /** Strikes with open interest, as a range; null = ±15 strikes around spot. */
  oiRange: [number, number] | null;
}
const L = (kind: PreviewLeg["kind"], side: PreviewLeg["side"], strike: number, price: number, iv: number): PreviewLeg => ({ kind, side, strike, price, iv });
export const PRESETS: readonly Preset[] = [
  { name: "Iron Condor", spot: 100_000, legs: [L("put", "buy", 90_000, 200, 55), L("put", "sell", 95_000, 800, 50), L("call", "sell", 105_000, 800, 50), L("call", "buy", 110_000, 200, 55)], oiRange: null },
  { name: "Long Call (Unlimited)", spot: 100_000, legs: [L("call", "buy", 100_000, 1500, 55)], oiRange: null },
  { name: "Short Strangle (Both Unlimited)", spot: 100_000, legs: [L("put", "sell", 95_000, 800, 50), L("call", "sell", 105_000, 800, 50)], oiRange: null },
  { name: "Wide chain, narrow leg (BTC 78k, chain 69k-87k)", spot: 78_000, legs: [L("call", "buy", 78_000, 1200, 55)], oiRange: [69_000, 87_000] },
];

export const PREVIEW_DAYS = 30;
export const DEFAULT_DAY = 15;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
export const TARGET_STEP = 100;
export const TARGET_NUDGE = 500;
const HALF_RANGE = 0.18;

/** Expiry date for every preset: 30 days from `nowMs`, as YYYY-MM-DD. */
export function previewExpiry(nowMs: number): string {
  return new Date(nowMs + PREVIEW_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
}
export function previewLegs(preset: Preset, expiry: string): Leg[] {
  return preset.legs.map((l) => ({ kind: l.kind, side: l.side, strike: l.strike, expiry, quantity: 1, price: l.price, iv: l.iv / 100 }));
}
export function zoomIn(z: number): number {
  return Math.min(ZOOM_MAX, Number((z * ZOOM_STEP).toFixed(4)));
}
export function zoomOut(z: number): number {
  return Math.max(ZOOM_MIN, Number((z / ZOOM_STEP).toFixed(4)));
}
/** Price axis around spot: ±18 % at 100 %, narrower when zoomed in. */
export function zoomRange(spot: number, zoom: number): [number, number] {
  const r = HALF_RANGE / zoom;
  return [Math.round(spot * (1 - r)), Math.round(spot * (1 + r))];
}
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface SdBands {
  m2: number;
  m1: number;
  p1: number;
  p2: number;
  days: number;
  byExpiry: boolean;
}
/** Lognormal ±1σ / ±2σ prices from the legs' average IV over the horizon (`days` 0 = to expiry). */
export function sdBands(preset: Preset, days: number): SdBands {
  const sigma = preset.legs.reduce((s, l) => s + l.iv, 0) / preset.legs.length / 100;
  const horizon = days > 0 ? days : PREVIEW_DAYS;
  const k = sigma * Math.sqrt(horizon / 365);
  const s = preset.spot;
  return { m2: s * Math.exp(-2 * k), m1: s * Math.exp(-k), p1: s * Math.exp(k), p2: s * Math.exp(2 * k), days: horizon, byExpiry: days <= 0 };
}

/** Deterministic open-interest shape: a bell around spot with a little strike-to-strike texture, normalised 0..1. */
export function syntheticOi(preset: Preset): { strike: number; value: number }[] {
  const step = 1000;
  const [lo, hi] = preset.oiRange ?? [preset.spot - 15 * step, preset.spot + 15 * step];
  const out: { strike: number; value: number }[] = [];
  for (let s = Math.ceil(lo / step) * step; s <= hi; s += step) {
    const d = (s - preset.spot) / (0.07 * preset.spot);
    const texture = 0.7 + 0.3 * Math.abs(Math.sin(s / 1370));
    out.push({ strike: s, value: Math.exp(-d * d) * texture });
  }
  const max = Math.max(0, ...out.map((o) => o.value));
  return max > 0 ? out.map((o) => ({ strike: o.strike, value: o.value / max })) : out;
}

export interface PreviewState {
  nowMs: number;
  day: number;
  target: number;
  zoom: number;
}
export interface PreviewComputed {
  result: AnalyzeResult;
  legs: Leg[];
  range: [number, number];
  expiry: string;
  sd: SdBands;
}
export function computePreview(preset: Preset, st: PreviewState): PreviewComputed {
  const expiry = previewExpiry(st.nowMs);
  const legs = previewLegs(preset, expiry);
  const range = zoomRange(preset.spot, st.zoom);
  const result = analyze(legs, { spot: preset.spot, nowMs: st.nowMs, targetDays: st.day, targetSpot: st.target, priceRange: range, points: 241 });
  return { result, legs, range, expiry, sd: sdBands(preset, st.day) };
}

/** "$100.0k" / "$100k" price labels. */
export function fmtK(v: number): string {
  const k = v / 1000;
  return `$${k >= 100 ? k.toFixed(0) : k.toFixed(1)}k`;
}
/** Signed compact money: "+$1.2k", "-$350". */
export function fmtSigned(v: number): string {
  const a = Math.abs(v);
  const body = a >= 1000 ? `${(a / 1000).toFixed(a >= 100_000 ? 0 : 1)}k` : Math.round(a).toString();
  return `${v < 0 ? "-" : "+"}$${body}`;
}
export function pctFrom(spot: number, price: number): string {
  const p = (price / spot - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}
/** "Fri, 18 Sep 02:30 PM" for the date slider. */
export function dayLabel(nowMs: number, day: number): string {
  const d = new Date(nowMs + day * MS_PER_DAY);
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${wd}, ${String(d.getDate()).padStart(2, "0")} ${mo} ${time}`;
}

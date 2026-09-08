// Pure helpers around the pricing engine's AnalyzeResult for the analysis pane (HC-WS-033, 046, 050..058,
// HC-TR-019). Display grading only; every number comes from @hapiecoin/pricing.
import type { AnalyzeResult, PayoffPoint } from "@hapiecoin/pricing";

export type Grade = { text: string; tone: "profit" | "loss" | "warning" | "muted" };

/** POP grade per the mock: ✓ high ≥ 60, moderate ≥ 40, low. */
export function popGrade(pop: number): Grade {
  if (!Number.isFinite(pop)) return { text: "calculating", tone: "muted" };
  const pct = pop * 100;
  if (pct >= 60) return { text: "✓ high", tone: "profit" };
  if (pct >= 40) return { text: "moderate", tone: "warning" };
  return { text: "low", tone: "loss" };
}

/** Reward-to-risk grade: ✓ favorable ≥ 2, balanced ≥ 1, high risk; unbounded cases named. */
export function rrGrade(rr: number, maxProfit: number, maxLoss: number): Grade {
  if (Number.isFinite(rr) && rr > 0) {
    if (rr >= 2) return { text: "✓ favorable", tone: "profit" };
    if (rr >= 1) return { text: "balanced", tone: "warning" };
    return { text: "high risk", tone: "loss" };
  }
  if (maxProfit === Number.POSITIVE_INFINITY && Number.isFinite(maxLoss)) return { text: "unlimited reward", tone: "profit" };
  if (maxLoss === Number.NEGATIVE_INFINITY) return { text: "unlimited exposure", tone: "loss" };
  return { text: "", tone: "muted" };
}

/** "R : R" tile text: "1 : 1.15", "1 : ∞", "∞ : 1" or "N/A". */
export function rrText(rr: number, maxProfit: number, maxLoss: number): string {
  if (Number.isFinite(rr) && rr > 0) return `1 : ${rr.toFixed(2)}`;
  if (maxProfit === Number.POSITIVE_INFINITY && Number.isFinite(maxLoss)) return "1 : ∞";
  if (maxLoss === Number.NEGATIVE_INFINITY && Number.isFinite(maxProfit)) return "∞ : 1";
  return "N/A";
}

/** Expiry P&L at a price by linear interpolation on the engine's points. */
export function pnlAt(points: readonly PayoffPoint[], price: number, key: "pnlExpiry" | "pnlTarget" = "pnlExpiry"): number {
  if (points.length === 0) return Number.NaN;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (price <= first.price) return first[key];
  if (price >= last.price) return last[key];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.price <= price) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const t = b.price === a.price ? 0 : (price - a.price) / (b.price - a.price);
  return a[key] + t * (b[key] - a[key]);
}

/** "Win if" text from the break-evens (HC-WS-056): "> 79,966", "77,660 – 81,341", "< a or > b", "any price", "varies". */
export function winZone(result: AnalyzeResult, fmt: (price: number) => string): string {
  const bes = result.breakevens;
  const pts = result.points;
  if (pts.length === 0) return "varies";
  const rightUp = pts[pts.length - 1]!.pnlExpiry > 0;
  const leftUp = pts[0]!.pnlExpiry > 0;
  if (bes.length === 0) return leftUp && rightUp ? "any price" : leftUp || rightUp ? "varies" : "no price";
  if (bes.length === 1) return `${rightUp ? ">" : "<"} ${fmt(bes[0]!)}`;
  if (bes.length === 2) {
    const mid = pnlAt(pts, (bes[0]! + bes[1]!) / 2) > 0;
    return mid ? `${fmt(bes[0]!)} – ${fmt(bes[1]!)}` : `< ${fmt(bes[0]!)} or > ${fmt(bes[1]!)}`;
  }
  return "varies";
}

/** Price where the expiry P&L reaches `value` (first hit), for the Max profit / Max loss tile sub-lines. */
export function whereExtreme(points: readonly PayoffPoint[], value: number): { price: number; side: "at" | "above" | "below" } | null {
  if (!Number.isFinite(value) || points.length === 0) return null;
  const eps = Math.max(1e-6, Math.abs(value) * 1e-4);
  const hits = points.filter((p) => Math.abs(p.pnlExpiry - value) <= eps);
  if (hits.length === 0) return null;
  const first = hits[0]!;
  const last = hits[hits.length - 1]!;
  if (hits.length === 1) return { price: first.price, side: "at" };
  if (last === points[points.length - 1]) return { price: first.price, side: "above" };
  if (first === points[0]) return { price: last.price, side: "below" };
  return { price: (first.price + last.price) / 2, side: "at" };
}

/**
 * Margin estimate for the strip and the Builder ticket (HC-WS-052, HC-TR-019) until the Phase 3 exchange
 * estimate: the worst expiry loss for defined-risk strategies; null (shown as "—") when the loss is unbounded.
 */
export function marginEstimate(result: AnalyzeResult): number | null {
  if (!Number.isFinite(result.maxLoss)) return null;
  return Math.max(0, -result.maxLoss);
}

/** Net premium per one underlying unit for the tile sub-line ("465.8 / BTC"). */
export function premiumPerUnit(netPremium: number, lots: readonly number[], lotSize: string | undefined): number | null {
  const size = Number(lotSize);
  if (!Number.isFinite(size) || size <= 0 || lots.length === 0) return null;
  const g = lots.reduce((a, b) => gcd(a, b), 0) || 1;
  return netPremium / (size * g);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

/** Ladder prices around spot at a step derived from spot (≈ 0.25 % rounded to a clean number), ±20 %. */
export function ladderPrices(spot: number, step?: number): number[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  const s = step ?? cleanStep(spot * 0.0025);
  const lo = Math.ceil((spot * 0.8) / s) * s;
  const hi = Math.floor((spot * 1.2) / s) * s;
  const out: number[] = [];
  for (let p = lo; p <= hi + 1e-9; p += s) out.push(Number(p.toFixed(6)));
  return out;
}

/** 1-2-5 style rounding of a raw step so the ladder reads cleanly (200, 500, 1,000 for BTC; 10, 20 for XAUT). */
export function cleanStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const m = raw / base;
  const pick = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return pick * base;
}

export type LadderStatus = "profit" | "loss" | "flat" | "breakeven" | "spot";

export interface LadderRow {
  price: number;
  changePct: number;
  atExpiry: number;
  onTarget: number;
  status: LadderStatus;
}

/** Ladder rows (HC-WS-062): the price list plus the spot row and each break-even, sorted, with a status pill. */
export function ladderRows(result: AnalyzeResult, spot: number, prices: readonly number[]): LadderRow[] {
  const scale = Math.max(1, ...result.points.map((p) => Math.abs(p.pnlExpiry)).filter(Number.isFinite));
  const eps = scale * 0.005;
  const rows = new Map<number, LadderStatus | null>();
  for (const p of prices) rows.set(p, null);
  rows.set(spot, "spot");
  for (const b of result.breakevens) if (!rows.has(b)) rows.set(b, "breakeven");
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([price, forced]) => {
      const atExpiry = pnlAt(result.points, price, "pnlExpiry");
      const onTarget = pnlAt(result.points, price, "pnlTarget");
      const status: LadderStatus = forced ?? (atExpiry > eps ? "profit" : atExpiry < -eps ? "loss" : "flat");
      return { price, changePct: ((price - spot) / spot) * 100, atExpiry, onTarget, status };
    });
}

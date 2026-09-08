// Canvas renderer for the payoff chart (HC-WS-038..045): pure function of a frame, so it is testable and
// runs once per animation frame. Colours come from the CSS tokens read by the caller (light and dark).
import type { PayoffPoint } from "@hapiecoin/pricing";

export interface PayoffColors {
  ink: string;
  target: string;
  profit: string;
  loss: string;
  grid: string;
  text: string;
  spot: string;
  breakeven: string;
  band: string;
  oi: string;
}

export interface PayoffFrame {
  width: number;
  height: number;
  points: readonly PayoffPoint[];
  spot: number;
  breakevens: readonly number[];
  /** ±1σ band edges in price, or null. */
  band: [number, number] | null;
  /** Target marker: price and the P&L on the target-date curve there. */
  target: { price: number; pnl: number } | null;
  targetLabel: string;
  layers: { expiry: boolean; target: boolean; fill: boolean; oi: boolean; band: boolean; breakeven: boolean };
  /** Open-interest bars per strike (combined), normalised 0..1, or empty. */
  oi: readonly { strike: number; value: number }[];
  /** Price axis range. */
  range: [number, number];
  colors: PayoffColors;
  fmtPrice: (p: number) => string;
  fmtMoney: (v: number) => string;
  /** Crosshair price when hovering, or null. */
  hover: number | null;
}

export interface PayoffScales {
  x: (price: number) => number;
  y: (pnl: number) => number;
  invX: (px: number) => number;
  m: { l: number; r: number; t: number; b: number };
  yMin: number;
  yMax: number;
}

/** Axis scales for a frame; y is symmetric-ish around zero with 8 % padding. */
export function payoffScales(frame: PayoffFrame): PayoffScales {
  const m = { l: 52, r: 16, t: 26, b: 26 };
  const pw = Math.max(1, frame.width - m.l - m.r);
  const ph = Math.max(1, frame.height - m.t - m.b);
  const [lo, hi] = frame.range;
  const ys = frame.points.flatMap((p) => [p.pnlExpiry, p.pnlTarget]).filter(Number.isFinite);
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax === yMin) {
    yMax += 1;
    yMin -= 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;
  const x = (price: number) => m.l + ((price - lo) / (hi - lo || 1)) * pw;
  const y = (pnl: number) => m.t + ((yMax - pnl) / (yMax - yMin)) * ph;
  const invX = (px: number) => lo + ((px - m.l) / pw) * (hi - lo);
  return { x, y, invX, m, yMin, yMax };
}

/** Clean y ticks (5 lines) for the axis. */
export function yTicks(yMin: number, yMax: number, n = 5): number[] {
  const span = yMax - yMin;
  if (!(span > 0)) return [0];
  const raw = span / (n - 1);
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const mm = raw / base;
  const step = (mm < 1.5 ? 1 : mm < 3.5 ? 2 : mm < 7.5 ? 5 : 10) * base;
  const out: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) out.push(Number(v.toFixed(8)));
  return out;
}

export function drawPayoff(ctx: CanvasRenderingContext2D, frame: PayoffFrame): PayoffScales {
  const { width: W, height: H, colors: c, layers } = frame;
  const s = payoffScales(frame);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  // grid + y axis
  ctx.strokeStyle = c.grid;
  ctx.fillStyle = c.text;
  ctx.lineWidth = 1;
  for (const v of yTicks(s.yMin, s.yMax)) {
    const y = Math.round(s.y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(s.m.l, y);
    ctx.lineTo(W - s.m.r, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(frame.fmtMoney(v), s.m.l - 6, y);
  }
  // x ticks (5)
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i += 1) {
    const p = frame.range[0] + ((frame.range[1] - frame.range[0]) * i) / 4;
    const x = Math.round(s.x(p)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, s.m.t);
    ctx.lineTo(x, H - s.m.b);
    ctx.stroke();
    ctx.fillText(frame.fmtPrice(p), x, H - s.m.b / 2);
  }
  // zero line
  ctx.strokeStyle = c.text;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(s.m.l, Math.round(s.y(0)) + 0.5);
  ctx.lineTo(W - s.m.r, Math.round(s.y(0)) + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // OI bars along the bottom
  if (layers.oi && frame.oi.length) {
    ctx.fillStyle = c.oi;
    const maxH = (H - s.m.t - s.m.b) * 0.22;
    const bw = Math.max(2, ((W - s.m.l - s.m.r) / Math.max(1, frame.oi.length)) * 0.6);
    for (const bar of frame.oi) {
      const x = s.x(bar.strike);
      if (x < s.m.l || x > W - s.m.r) continue;
      const h = Math.max(1, bar.value * maxH);
      ctx.fillRect(x - bw / 2, H - s.m.b - h, bw, h);
    }
  }

  // ±1σ band
  if (layers.band && frame.band) {
    const [b0, b1] = frame.band;
    ctx.fillStyle = c.band;
    ctx.fillRect(s.x(b0), s.m.t, Math.max(0, s.x(b1) - s.x(b0)), H - s.m.t - s.m.b);
    ctx.strokeStyle = c.text;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.6;
    for (const [p, label] of [[b0, `−1σ ${frame.fmtPrice(b0)}`], [b1, `+1σ ${frame.fmtPrice(b1)}`]] as const) {
      const x = Math.round(s.x(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, s.m.t);
      ctx.lineTo(x, H - s.m.b);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(label, x, H - s.m.b - 8);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const pts = frame.points;
  if (pts.length) {
    // fills between the expiry line and zero
    if (layers.fill && layers.expiry) {
      const y0 = s.y(0);
      for (const tone of ["profit", "loss"] as const) {
        ctx.beginPath();
        ctx.moveTo(s.x(pts[0]!.price), y0);
        for (const p of pts) {
          const v = tone === "profit" ? Math.max(0, p.pnlExpiry) : Math.min(0, p.pnlExpiry);
          ctx.lineTo(s.x(p.price), s.y(v));
        }
        ctx.lineTo(s.x(pts[pts.length - 1]!.price), y0);
        ctx.closePath();
        ctx.fillStyle = tone === "profit" ? c.profit : c.loss;
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // target-date curve
    if (layers.target) {
      ctx.strokeStyle = c.target;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(s.x(p.price), s.y(p.pnlTarget)) : ctx.lineTo(s.x(p.price), s.y(p.pnlTarget))));
      ctx.stroke();
    }
    // expiry line
    if (layers.expiry) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(s.x(p.price), s.y(p.pnlExpiry)) : ctx.lineTo(s.x(p.price), s.y(p.pnlExpiry))));
      ctx.stroke();
    }
  }

  // break-evens
  if (layers.breakeven) {
    ctx.strokeStyle = c.breakeven;
    ctx.fillStyle = c.breakeven;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    for (const be of frame.breakevens) {
      const x = Math.round(s.x(be)) + 0.5;
      if (x < s.m.l || x > W - s.m.r) continue;
      ctx.beginPath();
      ctx.moveTo(x, s.m.t);
      ctx.lineTo(x, H - s.m.b);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(`BE ${frame.fmtPrice(be)}`, x, s.m.t - 8);
    }
    ctx.setLineDash([]);
  }

  // spot hairline (the only amber)
  {
    const x = Math.round(s.x(frame.spot)) + 0.5;
    ctx.strokeStyle = c.spot;
    ctx.fillStyle = c.spot;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, s.m.t);
    ctx.lineTo(x, H - s.m.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.fillText(`SPOT ${frame.fmtPrice(frame.spot)}`, x, 10);
  }

  // target marker
  if (frame.target && layers.target) {
    const x = s.x(frame.target.price);
    const y = s.y(frame.target.pnl);
    ctx.strokeStyle = c.target;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, s.m.t);
    ctx.lineTo(Math.round(x) + 0.5, H - s.m.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = c.target;
    ctx.fill();
    ctx.textAlign = x > W / 2 ? "right" : "left";
    ctx.fillText(`${frame.fmtMoney(frame.target.pnl)} @ ${frame.fmtPrice(frame.target.price)} · ${frame.targetLabel}`, x + (x > W / 2 ? -8 : 8), y - 10);
  }

  // hover crosshair
  if (frame.hover !== null && pts.length) {
    const x = Math.round(s.x(frame.hover)) + 0.5;
    ctx.strokeStyle = c.text;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, s.m.t);
    ctx.lineTo(x, H - s.m.b);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  return s;
}

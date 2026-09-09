// Smooth heat field for the scenario matrix (HC-WS-092): a pure canvas renderer over the grid values, bilinear
// between cell centres, blended toward the page background, with the zero contour (break-even ridge), the
// column separators, the spot row hairline and the target cell outline. Testable without pixels.
export type Rgb = [number, number, number];

export interface HeatFrame {
  width: number;
  height: number;
  /** values[row][col], rows top to bottom (highest price first), cols left to right (today first). */
  cells: readonly (readonly number[])[];
  vmax: number;
  colors: { profit: Rgb; loss: Rgb; background: Rgb; foreground: Rgb; spot: Rgb };
  /** Row / column of the target cell, or null. */
  target: { i: number; j: number } | null;
  /** Row index of the spot price, or null. */
  spotRow: number | null;
}

/** "h s% l%" (the theme tokens) → RGB 0..255. */
export function hslTokenToRgb(token: string): Rgb {
  const parts = token.trim().split(/\s+/);
  const h = Number(parts[0]);
  const s = Number((parts[1] ?? "0").replace("%", "")) / 100;
  const l = Number((parts[2] ?? "50").replace("%", "")) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return [128, 128, 128];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Bilinear sample of the grid at fractional row / column coordinates (cell centres at integers). */
export function sampleGrid(cells: readonly (readonly number[])[], fy: number, fx: number): number {
  const nr = cells.length;
  const nc = cells[0]?.length ?? 0;
  if (nr === 0 || nc === 0) return 0;
  const y = Math.max(0, Math.min(nr - 1, fy));
  const x = Math.max(0, Math.min(nc - 1, fx));
  const i0 = Math.floor(y);
  const j0 = Math.floor(x);
  const i1 = Math.min(nr - 1, i0 + 1);
  const j1 = Math.min(nc - 1, j0 + 1);
  const ty = y - i0;
  const tx = x - j0;
  const v = (i: number, j: number) => {
    const c = cells[i]![j]!;
    return Number.isFinite(c) ? c : 0;
  };
  return v(i0, j0) * (1 - ty) * (1 - tx) + v(i0, j1) * (1 - ty) * tx + v(i1, j0) * ty * (1 - tx) + v(i1, j1) * ty * tx;
}

export function drawHeat(ctx: CanvasRenderingContext2D, frame: HeatFrame): void {
  const { width: W, height: H, cells, vmax, colors } = frame;
  const nr = cells.length;
  const nc = cells[0]?.length ?? 0;
  if (W < 2 || H < 2 || nr === 0 || nc === 0) return;
  const img: ImageData | undefined = ctx.createImageData(W, H);
  if (!img?.data) return; // no pixel buffer (test canvas): nothing to paint
  const d = img.data;
  const cw = W / nc;
  const rh = H / nr;
  for (let y = 0; y < H; y++) {
    const fy = y / rh - 0.5;
    for (let x = 0; x < W; x++) {
      const v = sampleGrid(cells, fy, x / cw - 0.5);
      const a = 0.08 + 0.62 * Math.min(1, Math.abs(v) / (vmax || 1));
      const tone = v >= 0 ? colors.profit : colors.loss;
      const o = (y * W + x) * 4;
      d[o] = Math.round(colors.background[0] * (1 - a) + tone[0] * a);
      d[o + 1] = Math.round(colors.background[1] * (1 - a) + tone[1] * a);
      d[o + 2] = Math.round(colors.background[2] * (1 - a) + tone[2] * a);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const ink = `rgb(${colors.foreground.join(",")})`;
  // column separators
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let j = 1; j < nc; j++) {
    ctx.beginPath();
    ctx.moveTo(Math.round(j * cw) + 0.5, 0);
    ctx.lineTo(Math.round(j * cw) + 0.5, H);
    ctx.stroke();
  }
  // zero contour: where a column changes sign between two rows, a dashed tick at the interpolated crossing
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([3, 3]);
  for (let j = 0; j < nc; j++) {
    for (let i = 0; i < nr - 1; i++) {
      const a0 = cells[i]![j]!;
      const a1 = cells[i + 1]![j]!;
      if (!Number.isFinite(a0) || !Number.isFinite(a1) || a0 >= 0 === a1 >= 0) continue;
      const t = a0 / (a0 - a1);
      const y = (i + 0.5 + t) * rh;
      ctx.beginPath();
      ctx.moveTo(j * cw, y);
      ctx.lineTo((j + 1) * cw, y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (frame.spotRow !== null) {
    ctx.fillStyle = `rgb(${colors.spot.join(",")})`;
    ctx.fillRect(0, Math.round((frame.spotRow + 0.5) * rh), W, 1);
  }
  if (frame.target) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(frame.target.j * cw + 1, frame.target.i * rh + 1, cw - 2, rh - 2);
  }
}

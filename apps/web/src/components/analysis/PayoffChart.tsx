"use client";
// Canvas host for the payoff chart (HC-WS-038..045): sizes to its box, draws once per animation frame,
// reads the theme's colour tokens from CSS and reports the hovered price.
import { useEffect, useMemo, useRef, useState } from "react";
import { type PayoffColors, type PayoffFrame, drawPayoff, payoffScales } from "./payoffDraw";

export type PayoffChartFrame = Omit<PayoffFrame, "width" | "height" | "colors" | "hover">;

function token(style: CSSStyleDeclaration, name: string, alpha?: number): string {
  const v = style.getPropertyValue(name).trim() || "0 0% 50%";
  return alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`;
}

const FALLBACK: PayoffColors = { ink: "#ccc", target: "#58f", profit: "#2a7", loss: "#c33", grid: "#333", text: "#888", spot: "#d90", breakeven: "#888", band: "rgba(255,255,255,0.05)", oi: "rgba(128,128,128,0.25)" };

/** Colours for the canvas, re-read when the theme class flips. */
function useCanvasColors(): PayoffColors {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return useMemo(() => {
    void tick; // theme-change counter: re-read the tokens after the class flips
    if (typeof document === "undefined") return FALLBACK;
    const s = getComputedStyle(document.documentElement);
    return {
      ink: token(s, "--foreground"),
      target: token(s, "--curve"),
      profit: token(s, "--profit"),
      loss: token(s, "--loss"),
      grid: token(s, "--border"),
      text: token(s, "--muted-foreground"),
      spot: token(s, "--spot"),
      breakeven: token(s, "--muted-foreground"),
      band: token(s, "--foreground", 0.05),
      oi: token(s, "--muted-foreground", 0.25),
    };
  }, [tick]);
}

export function PayoffChart({ frame, onHover, onSelect, className }: { frame: PayoffChartFrame; onHover?: (price: number | null) => void; onSelect?: ((price: number) => void) | undefined; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const colors = useCanvasColors();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      return;
    }
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w < 10 || size.h < 10) return;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPayoff(ctx, { ...frame, width: size.w, height: size.h, colors, hover });
    });
    return () => cancelAnimationFrame(raf);
  }, [frame, size, colors, hover]);

  const toPrice = (clientX: number): number | null => {
    const canvas = ref.current;
    if (!canvas || size.w < 10) return null;
    const rect = canvas.getBoundingClientRect();
    const s = payoffScales({ ...frame, width: size.w, height: size.h, colors, hover: null });
    const px = clientX - rect.left;
    if (px < s.m.l || px > size.w - s.m.r) return null;
    return s.invX(px);
  };

  return (
    <div ref={box} className={className} data-testid="payoff-chart" data-points={frame.points.length}>
      <canvas
        ref={ref}
        role="img"
        aria-label="Payoff chart: profit and loss against the underlying price at expiry and on the target date"
        onPointerMove={(e) => {
          const p = toPrice(e.clientX);
          setHover(p);
          onHover?.(p);
        }}
        onPointerLeave={() => {
          setHover(null);
          onHover?.(null);
        }}
        onClick={(e) => {
          const p = toPrice(e.clientX); // HC-WS-084: a click sets the target price
          if (p !== null) onSelect?.(p);
        }}
        style={{ width: size.w, height: size.h, display: "block", cursor: onSelect ? "crosshair" : undefined }}
      />
    </div>
  );
}

"use client";
// Horizontal scroll state shared by the calls and puts sides of the chain (GAPS #2). The single source of
// truth is `inner`: how far each side is scrolled away from the strike column (0 = the columns nearest the
// strike are visible on both sides). The calls track offset is therefore `max − inner` and the puts track
// offset is `inner`, so the same column faces the strike on both sides and a resize keeps the inner
// columns in view. Both tracks render with `translateX`, so the header parts and every virtual row stay
// aligned by construction; two detached scrollbars in the footer expose the position to the mouse, and
// wheel / arrow keys move it directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { clampOffset } from "@/lib/chain/range";

export interface MirroredScroll {
  /** Calls track offset (px from its left edge) = max − inner. */
  x: number;
  /** Puts track offset (px from its left edge) = inner. */
  putsX: number;
  /** Largest offset; 0 when the track fits. */
  max: number;
  /** Set the calls offset (clamped); the puts side follows. */
  setX: (x: number) => void;
  /** Move by a delta as seen from one side; a positive delta on the puts side moves the calls side the other way. */
  scrollBy: (delta: number, side: "calls" | "puts") => void;
  /** Report the measured width of one side's viewport. */
  setViewportWidth: (width: number) => void;
  /** Handle a wheel event from either side; returns true when it consumed a horizontal move. */
  onWheel: (e: { deltaX: number; deltaY: number; shiftKey: boolean }, side: "calls" | "puts") => boolean;
}

export function useMirroredScroll(trackWidth: number, initialViewportWidth = 0): MirroredScroll {
  const [viewportWidth, setViewportWidthState] = useState(initialViewportWidth);
  const max = Math.max(0, Math.round(trackWidth - viewportWidth));
  const [inner, setInner] = useState(0);

  const setViewportWidth = useCallback((width: number) => {
    setViewportWidthState((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
  }, []);

  // Keep the offset inside the new bounds when the viewport or track changes.
  useEffect(() => {
    setInner((prev) => clampOffset(prev, max));
  }, [max]);

  const setX = useCallback((x: number) => setInner(clampOffset(max - x, max)), [max]);
  const scrollBy = useCallback(
    (delta: number, side: "calls" | "puts") => setInner((prev) => clampOffset(prev + (side === "calls" ? -delta : delta), max)),
    [max],
  );
  const onWheel = useCallback(
    (e: { deltaX: number; deltaY: number; shiftKey: boolean }, side: "calls" | "puts") => {
      if (max <= 0) return false;
      const delta = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return false;
      scrollBy(delta, side);
      return true;
    },
    [max, scrollBy],
  );

  const clamped = clampOffset(inner, max);
  return useMemo(
    () => ({ x: max - clamped, putsX: clamped, max, setX, scrollBy, setViewportWidth, onWheel }),
    [clamped, max, setX, scrollBy, setViewportWidth, onWheel],
  );
}

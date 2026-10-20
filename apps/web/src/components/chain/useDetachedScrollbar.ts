"use client";
// A detached horizontal scrollbar that mirrors a shared offset (GAPS #2) without ever fighting the mouse (GAPS #128).
// While a thumb is held, the browser owns the bar's position: a write from here would be undone on the next pointer
// move, and the two scroll events would feed each other through `setX` until React gave up with "Maximum update
// depth exceeded". So the bar follows the state only when nobody holds it, the write happens in an animation frame
// outside React's commit, the scroll event that write causes is recognised and dropped, and a release catches up once.
import { type RefObject, useEffect, useRef } from "react";

export interface DetachedScrollbar {
  /** The bar's scroll handler: turns a user scroll into `setX`, drops echoes of the bar's own writes. */
  onScroll: (left: number) => void;
}

/** Keep `ref`'s scrollLeft at `target` (clamped to the bar's own maximum) and report user scrolls through `setX`. */
export function useDetachedScrollbar(ref: RefObject<HTMLElement | null>, target: number, setX: (left: number) => void): DetachedScrollbar {
  const held = useRef(false);
  const expected = useRef<number | null>(null);
  const targetRef = useRef(target);
  const setXRef = useRef(setX);
  targetRef.current = target;
  setXRef.current = setX;

  const write = (el: HTMLElement, want: number) => {
    const before = el.scrollLeft;
    expected.current = want;
    el.scrollLeft = want;
    // a write the browser snapped back to the same offset fires no scroll event: nothing to drop later
    if (el.scrollLeft === before) expected.current = null;
  };
  const wanted = (el: HTMLElement) => Math.min(targetRef.current, Math.max(0, el.scrollWidth - el.clientWidth));

  // Hold and release, registered once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grab = (e: MouseEvent | TouchEvent) => {
      if ("button" in e && e.button !== 0) return;
      held.current = true;
    };
    const release = () => {
      if (!held.current) return;
      held.current = false;
      const want = wanted(el);
      if (Math.abs(el.scrollLeft - want) > 0.5) write(el, want);
    };
    el.addEventListener("mousedown", grab);
    el.addEventListener("touchstart", grab, { passive: true });
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
    window.addEventListener("touchcancel", release);
    window.addEventListener("blur", release);
    return () => {
      el.removeEventListener("mousedown", grab);
      el.removeEventListener("touchstart", grab);
      window.removeEventListener("mouseup", release);
      window.removeEventListener("touchend", release);
      window.removeEventListener("touchcancel", release);
      window.removeEventListener("blur", release);
    };
  }, [ref]);

  // Follow the state, in a frame, never while held.
  useEffect(() => {
    const el = ref.current;
    if (!el || held.current) return;
    if (Math.abs(el.scrollLeft - wanted(el)) <= 0.5) return;
    let frame: number | null = null;
    const run = () => {
      frame = null;
      if (held.current) return;
      const want = wanted(el);
      if (Math.abs(el.scrollLeft - want) > 0.5) write(el, want);
    };
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(run);
    else run();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref, target]);

  return {
    onScroll: (left: number) => {
      // the echo of our own write (the browser may snap it to its own pixel grid)
      if (expected.current !== null && Math.abs(left - expected.current) < 1.5) {
        expected.current = null;
        return;
      }
      expected.current = null;
      if (Math.abs(left - targetRef.current) < 0.5) return;
      setXRef.current(left);
    },
  };
}

"use client";
// One media-query hook for the responsive seams (ADR-080; HC-SH-130): false during SSR and the first client render, so
// the server and the client agree, then the live value. `useCoarsePointer` is the touch signal the chain uses to show
// row controls on tap and grow them to finger size.
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** True when the viewport is narrower than `px` (the workspace stacks below 1000, the header compacts below 768). */
export const useNarrow = (px: number): boolean => useMediaQuery(`(max-width: ${px - 1}px)`);

/** A touch screen (or any pointer without hover): controls must appear on tap and be finger-sized. */
export const useCoarsePointer = (): boolean => useMediaQuery("(pointer: coarse)");

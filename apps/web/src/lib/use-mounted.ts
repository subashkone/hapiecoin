"use client";
// True after the first client render. Use it for markup that depends on browser-only state (stored theme,
// viewport) so the server HTML and the first client render stay identical (no hydration mismatch).
import { useEffect, useState } from "react";

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

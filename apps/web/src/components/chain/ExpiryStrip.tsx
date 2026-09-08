"use client";
// Expiry strip (HC-WS-007, HC-WS-008, HC-TR-028): a horizontal row of chips with ‹ › scroll buttons that
// appear only when the strip overflows its box. The chips themselves are supplied by the caller.
import { cn } from "@hapiecoin/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function ExpiryStrip({ children, className, label = "Expiry", testId = "expiry-strip" }: { children: ReactNode; className?: string; label?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollWidth - el.clientWidth > 2);
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);
  const scrollBy = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * Math.max(120, (ref.current.clientWidth || 0) * 0.6), behavior: "smooth" });
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)} data-testid={testId} data-overflow={overflow}>
      {overflow ? (
        <button type="button" onClick={() => scrollBy(-1)} className="h-[30px] w-[18px] shrink-0 rounded-[3px] text-[15px] text-muted-foreground hover:bg-surface-3 hover:text-foreground" title="Previous expiries" aria-label="Previous expiries" data-testid={`${testId}-prev`}>
        ‹
        </button>
      ) : null}
      <div ref={ref} role="tablist" aria-label={label} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" onScroll={measure}>
        {children}
      </div>
      {overflow ? (
        <button type="button" onClick={() => scrollBy(1)} className="h-[30px] w-[18px] shrink-0 rounded-[3px] text-[15px] text-muted-foreground hover:bg-surface-3 hover:text-foreground" title="Next expiries" aria-label="Next expiries" data-testid={`${testId}-next`}>
        ›
        </button>
      ) : null}
    </div>
  );
}

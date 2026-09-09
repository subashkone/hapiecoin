"use client";
// Segmented chips (timeframes, table tabs, gainers/losers): one selected, keyboard reachable.
import { cn } from "@hapiecoin/ui";

export function Chips<T extends string>({ items, value, onChange, className, testId, labels }: { items: readonly T[]; value: T; onChange: (v: T) => void; className?: string; testId?: string; labels?: Partial<Record<T, string>> }) {
  return (
    <div className={cn("inline-flex rounded border border-border p-0.5", className)} role="tablist" data-testid={testId}>
      {items.map((it) => (
        <button key={it} type="button" role="tab" aria-selected={it === value} onClick={() => onChange(it)} className={cn("rounded px-2 py-0.5 font-mono text-2xs", it === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-value={it}>
          {labels?.[it] ?? it}
        </button>
      ))}
    </div>
  );
}

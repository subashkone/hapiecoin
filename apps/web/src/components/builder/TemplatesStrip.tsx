"use client";
// Strategy templates one click away, under the Builder legs (HC-TR-040, ADR-027): a collapsible strip with the
// four outlook tabs, the expiry select and the template cards in a scroll row. Clicking a card replaces the Builder
// legs; the Templates tab keeps the full gallery and My templates.
import { cn } from "@hapiecoin/ui";
import { useState } from "react";
import { daysToExpiry, fmtExpiry } from "@/lib/format";
import { useUiStore } from "@/lib/store";
import { TEMPLATES, TEMPLATE_COUNT, type TemplateCategory } from "@/lib/strategy/templates";
import { templateSketch, useTemplateLoader } from "./TemplatesPanel";

const OUTLOOKS: readonly TemplateCategory[] = ["Bullish", "Bearish", "Neutral", "Others"];

export function TemplatesStrip() {
  const open = useUiStore((s) => s.templatesStrip);
  const setOpen = useUiStore((s) => s.setTemplatesStrip);
  const setBuilderTab = useUiStore((s) => s.setBuilderTab);
  const legCount = useUiStore((s) => s.legs[s.asset].length);
  const { expiry, list, setChosen, load, chainReady } = useTemplateLoader();
  const [outlook, setOutlook] = useState<TemplateCategory>("Bullish");
  const cards = TEMPLATES.filter((t) => t.category === outlook);
  return (
    <section className="mt-3 rounded border border-border" data-testid="templates-strip" data-open={open}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" className="flex items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="templates-strip-toggle">
          <span className="micro">Strategy templates</span>
          <span className="text-2xs text-muted-foreground">{open ? "▴" : "▾"}</span>
        </button>
        {open ? (
          <>
            <div className="ml-2 flex gap-0.5">
              {OUTLOOKS.map((o) => (
                <button key={o} type="button" aria-pressed={outlook === o} onClick={() => setOutlook(o)} className={cn("rounded px-1.5 py-0.5 text-2xs", outlook === o ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`strip-cat-${o.toLowerCase()}`}>
                  {o}
                </button>
              ))}
            </div>
            <select className="ml-auto h-6 rounded border border-input bg-background px-1 font-mono text-2xs text-foreground" value={expiry ?? ""} onChange={(e) => setChosen(e.target.value)} aria-label="Template expiry" data-testid="strip-expiry">
              {list.map((e) => (
                <option key={e} value={e}>
                  {fmtExpiry(e)} · {daysToExpiry(e)}d
                </option>
              ))}
            </select>
            <button type="button" className="text-2xs text-muted-foreground hover:text-foreground" onClick={() => setBuilderTab("templates")} data-testid="strip-see-all">
              All {TEMPLATE_COUNT} →
            </button>
          </>
        ) : (
          <span className="ml-auto micro">{cards.length} {outlook.toLowerCase()} · one click to load</span>
        )}
      </div>
      {open ? (
        <div className="flex gap-2 overflow-x-auto px-2 pb-2" data-testid="strip-cards">
          {cards.map((t) => (
            <button
              key={t.name}
              type="button"
              disabled={!chainReady}
              title={chainReady ? (legCount ? `Replace the ${legCount} Builder ${legCount === 1 ? "leg" : "legs"} with ${t.name}` : t.description) : "Chain not loaded yet"}
              onClick={() => load(t)}
              className="flex w-[124px] shrink-0 flex-col items-center gap-1 rounded border border-border p-1.5 text-center hover:border-foreground/40 disabled:opacity-50"
              data-testid="strip-card"
              data-name={t.name}
            >
              <svg viewBox="0 0 100 40" width="100" height="36" className="rounded bg-surface-2" aria-hidden>
                <line x1="0" x2="100" y1="20" y2="20" stroke="hsl(var(--border))" strokeWidth="1" />
                <polyline points={templateSketch(t)} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.4" />
              </svg>
              <span className="text-2xs font-medium leading-tight">{t.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

"use client";
// Product tour (HC-SH-064..076, 112; ADR-036): an SVG-masked overlay with a cut-out around the current anchor, a ring,
// and a popover with Previous / Next / progress. Steps can switch the workspace tab and wait for an app event so
// the trader performs the step. Runs only on /analyse; starts once automatically after the flyer popup closes.
import { Button } from "@hapiecoin/ui";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@hapiecoin/ui";
import { useMe } from "@/lib/api/queries";
import { useUiStore } from "@/lib/store";
import { TOUR_STEPS, type TourEvent, type TourStep, findTourTarget, markTourDone, onTourEvent, tourDone } from "@/lib/tour";

interface Box { x: number; y: number; w: number; h: number }
const PAD = 6;

export function TourOverlay({ onClose }: { onClose: (completed: boolean) => void }) {
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pop, setPop] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const popRef = useRef<HTMLDivElement>(null);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const step: TourStep = TOUR_STEPS[idx] ?? TOUR_STEPS[0]!;
  const n = TOUR_STEPS.length;
  const go = useCallback((i: number) => {
    if (i < 0) return;
    if (i >= n) { onClose(true); return; }
    setIdx(i);
  }, [n, onClose]);

  const place = useCallback(() => {
    const target = findTourTarget(step);
    const pw = popRef.current?.offsetWidth ?? 320;
    const ph = popRef.current?.offsetHeight ?? 160;
    if (!target) {
      setBox(null);
      setPop({ left: Math.max(8, (window.innerWidth - pw) / 2), top: Math.max(8, (window.innerHeight - ph) / 2) });
      return;
    }
    try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* jsdom */ }
    const r = target.getBoundingClientRect();
    setBox({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
    let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    let top: number;
    if (r.bottom + 14 + ph <= window.innerHeight - 8) top = r.bottom + 14;
    else if (r.top - 14 - ph >= 8) top = r.top - 14 - ph;
    else { top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8)); left = r.right + 14 + pw <= window.innerWidth ? r.right + 14 : Math.max(8, r.left - pw - 14); }
    setPop({ left, top });
  }, [step]);

  useEffect(() => {
    if (step.tab) setWorkspaceTab(step.tab);
    place();
    const t1 = setTimeout(place, 180);
    const t2 = setTimeout(place, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [step, place, setWorkspaceTab]);
  useEffect(() => {
    const waits = step.waitFor;
    if (!waits) return;
    const offs = (Object.keys(waits) as TourEvent[]).map((ev) => onTourEvent(ev, () => go(idx + (waits[ev] ?? 1))));
    return () => offs.forEach((off) => off());
  }, [step, idx, go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(false); } // before any open dialog's own Escape
      else if (e.key === "ArrowRight") go(idx + 1);
      else if (e.key === "ArrowLeft") go(idx - 1);
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [idx, go, onClose, place]);

  return (
    <div data-testid="tour" data-step={idx + 1} data-target={step.target ?? ""} data-anchored={box !== null}>
      <svg className="pointer-events-none fixed inset-0 z-[140] h-full w-full" aria-hidden="true">
        <defs>
          <mask id="hc-tour-mask">
            <rect width="100%" height="100%" fill="#fff" />
            {box ? <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="4" fill="#000" /> : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(4,6,10,0.66)" mask="url(#hc-tour-mask)" />
      </svg>
      {box ? <div className="pointer-events-none fixed z-[141] rounded border-2 border-accent" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} data-testid="tour-ring" /> : null}
      <div ref={popRef} role="dialog" aria-live="polite" aria-label={step.title} className="fixed z-[150] w-[320px] max-w-[calc(100vw-16px)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-[0_14px_40px_-14px_rgba(0,0,0,0.7)]" style={{ left: pop.left, top: pop.top, pointerEvents: "auto" }} data-testid="tour-popover">
        <button type="button" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" aria-label="Close tour" onClick={() => onClose(false)} data-testid="tour-close">✕</button>
        <h4 className="pr-6 text-[14px] font-semibold" data-testid="tour-title">{step.title}</h4>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="tour-desc">{step.desc}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="micro" data-testid="tour-progress">{idx + 1} / {n}</span>
          <span className="flex-1" />
          {idx > 0 ? <Button size="sm" variant="outline" onClick={() => go(idx - 1)} data-testid="tour-prev">Previous</Button> : null}
          <Button size="sm" onClick={() => go(idx + 1)} data-testid="tour-next">{idx === n - 1 ? "Done" : (step.next ?? "Next")}</Button>
        </div>
      </div>
    </div>
  );
}

/** Mounted in the app shell: starts the tour once on /analyse (after any flyer closes) and on request from the menu or palette. */
export function Tour() {
  const pathname = usePathname();
  const onAnalyse = pathname === "/analyse";
  const { data: me } = useMe();
  const requested = useUiStore((s) => s.tourRequested);
  const [active, setActive] = useState(false);
  const lastRequest = useRef(requested);
  useEffect(() => {
    if (!onAnalyse) setActive(false); // leaving the workspace ends the tour
  }, [onAnalyse]);
  useEffect(() => {
    if (!onAnalyse || !me || tourDone()) return;
    let cancelled = false;
    const tryStart = () => {
      if (cancelled) return;
      if (document.querySelector("[data-testid=flyer]")) { setTimeout(tryStart, 500); return; } // after the flyer (HC-SH-076)
      markTourDone();
      setActive(true);
    };
    const t = setTimeout(tryStart, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [onAnalyse, me]);
  useEffect(() => {
    if (requested === lastRequest.current) return;
    lastRequest.current = requested;
    if (onAnalyse) { markTourDone(); setActive(true); }
  }, [requested, onAnalyse]);
  const close = useCallback((completed: boolean) => {
    setActive(false);
    if (completed) toast.success("Tour complete", { description: "Replay it anytime from Settings → Take a tour, or Ctrl K and type tour." });
  }, []);
  if (!active || !onAnalyse) return null;
  return <TourOverlay onClose={close} />;
}

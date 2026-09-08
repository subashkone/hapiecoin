"use client";
// Flyer popup carousel (HC-SH-055, HC-SH-056; ADR-033): the banners showing now, at each banner's frequency, on
// /analyse. Previous / Next and dots cycle, "View" follows the link (hapiecoin.com in place, others in a new tab),
// "Don't show again" hides that banner on this browser for good. Also used by the admin's "Preview as user".
import { BANNER_FREQUENCY_LABELS, type Banner } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { bannerRoute, dueBanners, markShown, neverShow, useLiveBanners } from "@/lib/api/banners";
import { fmtDate } from "@/lib/format";
import { useUiStore } from "@/lib/store";

export function FlyerDialog({ banners, preview = false, onClose }: { banners: readonly Banner[]; preview?: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const router = useRouter();
  const b = banners[i] ?? banners[0];
  if (!b) return null;
  const route = bannerRoute(b.linkUrl);
  const view = () => {
    if (!route) return;
    if (route.external) window.open(route.href, "_blank", "noopener,noreferrer");
    else router.push(route.href);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[520px]" data-testid="flyer" data-index={i} data-count={banners.length} data-preview={preview}>
        {b.imageUrl ? <img src={b.imageUrl} alt="" className="aspect-[1200/630] w-full object-cover" data-testid="flyer-image" /> : <div className="aspect-[1200/630] w-full bg-muted" />}
        <DialogBody className="px-5 pt-4">
          <span className="micro">{preview ? "Preview · " : ""}Announcement · {i + 1} of {banners.length}</span>
          <DialogTitle className="mt-1 line-clamp-2 text-[16px] font-semibold" data-testid="flyer-title">{b.title}</DialogTitle>
          <DialogDescription className="mt-1 text-xs" data-testid="flyer-description">{b.description}</DialogDescription>
          {b.startsAt || b.endsAt ? <p className="micro mt-2">{b.startsAt ? fmtDate(b.startsAt) : ""}{b.endsAt ? ` → ${fmtDate(b.endsAt)}` : ""}</p> : null}
        </DialogBody>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs">
          {banners.length > 1 ? <Button size="sm" variant="ghost" onClick={() => setI((i - 1 + banners.length) % banners.length)} aria-label="Previous flyer" data-testid="flyer-prev">←</Button> : null}
          <span className="flex gap-1" data-testid="flyer-dots">{banners.map((x, k) => <span key={x.id} className={cn("h-1.5 w-1.5 rounded-full", k === i ? "bg-foreground" : "bg-border")} />)}</span>
          {banners.length > 1 ? <Button size="sm" variant="ghost" onClick={() => setI((i + 1) % banners.length)} aria-label="Next flyer" data-testid="flyer-next">→</Button> : null}
          <span className="micro ml-1" data-testid="flyer-frequency">{BANNER_FREQUENCY_LABELS[b.frequency]}</span>
          <span className="flex-1" />
          {!preview ? <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => { neverShow(b.id); toast("Hidden", { description: `${b.title} will not show again on this browser` }); if (banners.length === 1) onClose(); else setI(i % Math.max(1, banners.length - 1)); }} data-testid="flyer-never">Don't show again</button> : null}
          <Button size="sm" variant="outline" onClick={onClose} data-testid="flyer-dismiss">Dismiss</Button>
          {route ? <Button size="sm" onClick={view} data-testid="flyer-view">View{route.external ? " ↗" : " →"}</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted in the analyse header: fetches the live banners once, shows the ones due under their frequency rules
 * 400 ms after landing on /analyse, and reopens all of them when the palette asks (store.flyersRequested).
 */
export function FlyerPopup() {
  const pathname = usePathname();
  const onAnalyse = pathname === "/analyse";
  const { data } = useLiveBanners(onAnalyse);
  const requested = useUiStore((s) => s.flyersRequested);
  const [open, setOpen] = useState<Banner[] | null>(null);
  const shownOnce = useRef(false);
  const lastRequest = useRef(requested);
  useEffect(() => {
    if (!onAnalyse || !data || shownOnce.current) return;
    shownOnce.current = true;
    const due = dueBanners(data, new Date());
    if (due.length === 0) return;
    const t = setTimeout(() => {
      markShown(due, new Date());
      setOpen(due);
    }, 400);
    return () => clearTimeout(t);
  }, [onAnalyse, data]);
  useEffect(() => {
    if (requested === lastRequest.current) return;
    lastRequest.current = requested;
    const all = dueBanners(data ?? [], new Date(), true);
    if (all.length === 0) {
      toast("No active flyers", { description: "There are no banners scheduled right now." });
      return;
    }
    setOpen(all);
  }, [requested, data]);
  useEffect(() => {
    if (!onAnalyse) setOpen(null); // the flyer closes on route change
  }, [onAnalyse]);
  if (!open || open.length === 0) return null;
  return <FlyerDialog banners={open} onClose={() => setOpen(null)} />;
}

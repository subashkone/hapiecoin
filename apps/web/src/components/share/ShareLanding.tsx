"use client";
// /s/:code (HC-WS-106): decode the link, load its legs into the workspace store, say so, and go to the Desk. No
// account is needed to decode; the Desk itself asks for a sign-in and the legs wait in the persisted store.
import { Button, toast } from "@hapiecoin/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { fmtPrice } from "@/lib/format";
import { hasAdjustWork, useUiStore } from "@/lib/store";
import { venueSymbol } from "@/lib/strategy/legs";
import { decodeShare } from "@/lib/strategy/share";

export function ShareLanding({ code }: { code: string }) {
  const router = useRouter();
  const shared = useMemo(() => decodeShare(code), [code]);
  const applied = useRef(false);
  useEffect(() => {
    if (!shared || applied.current) return;
    applied.current = true;
    const s = useUiStore.getState();
    if (hasAdjustWork(s.adjust)) {
      // an adjustment with orders or plans is open in this session: ask about it first, leave the Builder untouched
      toast("Finish the adjustment first", { description: "Leave the workbench, then open the link again" });
      s.setWorkspaceTab("builder");
      router.replace("/desk");
      return;
    }
    // the link names its venue (ADR-069); a Builder holding another venue's legs is asked first, on /desk
    s.requestVenue(shared.venue, () => {
      s.setAsset(shared.asset);
      s.setLegs(shared.asset, []);
      let added = 0;
      for (const leg of shared.legs) if (s.addLeg(leg).ok) added += 1;
      s.setStrategyMeta(shared.asset, { name: shared.name, draftId: null, priceMode: "custom" });
      s.setWorkspaceTab("builder");
      s.setAnalysisTab("payoff");
      toast("Strategy loaded from link", { description: `${shared.name || "Shared strategy"} · ${added} ${added === 1 ? "leg" : "legs"} at the shared entry prices` });
    });
    router.replace("/desk");
  }, [shared, router]);
  if (!shared) {
    return (
      <div className="mx-auto max-w-[520px] rounded-md border border-border bg-card p-5 text-sm" data-testid="share-landing" data-state="invalid">
        <h1 className="text-base font-semibold">This link is not a HapieCoin strategy</h1>
        <p className="mt-1 text-muted-foreground">The code could not be decoded. Ask for a fresh link from the Share button on the Desk, or build your own.</p>
        <Button asChild size="sm" className="mt-3"><Link href="/desk">Open the Desk</Link></Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[520px] rounded-md border border-border bg-card p-5 text-sm" data-testid="share-landing" data-state="ready" data-legs={shared.legs.length}>
      <div className="micro">Shared strategy</div>
      <h1 className="text-base font-semibold">{shared.name || "Shared strategy"} · {shared.asset}</h1>
      <ul className="mt-2 space-y-0.5 font-mono text-2xs">
        {shared.legs.map((l, i) => (
          <li key={i}>
            <span className={l.side === "buy" ? "text-buy" : "text-sell"}>{l.side.toUpperCase()}</span> {l.lots} × {venueSymbol(l.kind, l.asset, l.strike, l.expiry, shared.venue)} @ {fmtPrice(l.price)}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted-foreground">Opening it on the Desk at the shared entry prices…</p>
      <Button asChild size="sm" className="mt-2"><Link href="/desk" data-testid="share-open-desk">Open on the Desk</Link></Button>
    </div>
  );
}

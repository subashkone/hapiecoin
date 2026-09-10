"use client";
// Share strategy (HC-WS-105): the link carries the legs, lots and entry prices; Copy puts it on the clipboard.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useMemo } from "react";
import { fmtPrice } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { copyText } from "@/lib/strategy/journal";
import { encodeShare, shareUrl } from "@/lib/strategy/share";
import { guessTemplateName } from "@/lib/strategy/templates";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";

export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const a = useStrategyAnalysis();
  const storedName = useUiStore((s) => s.strategy[s.asset].name);
  const name = storedName.trim() || guessTemplateName(a.legs);
  const link = useMemo(() => (a.legs.length ? shareUrl(typeof window === "undefined" ? "" : window.location.origin, encodeShare({ asset: a.asset, name, legs: a.legs })) : ""), [a.legs, a.asset, name]);
  const copy = async () => {
    const ok = await copyText(link);
    if (ok) toast("Link copied to clipboard", { description: link.length > 80 ? `${link.slice(0, 80)}…` : link });
    else toast.error("Could not copy", { description: "Select the link and copy it by hand" });
  };
  const r = a.result;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Share strategy</DialogTitle>
          <DialogDescription>
            {name} · {a.asset} · {a.legs.length} {a.legs.length === 1 ? "leg" : "legs"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <p className="text-muted-foreground">Anyone with this link sees a preview of the strategy and can open it in Analyse. Legs, lots and entry prices are encoded in the link itself — nothing is uploaded.</p>
          <div className="flex gap-2">
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="num h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-2xs" aria-label="Share link" data-testid="share-link" />
            <Button size="sm" onClick={() => void copy()} data-testid="share-copy">Copy</Button>
          </div>
          <ul className="space-y-0.5 font-mono text-2xs" data-testid="share-legs">
            {a.legs.map((l) => (
              <li key={l.id}>
                <span className={cn("font-bold", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side.toUpperCase()}</span> {l.lots} × {l.symbol} @ {fmtPrice(l.price)}
              </li>
            ))}
          </ul>
          {r ? (
            <div className="flex flex-wrap gap-x-4 text-2xs" data-testid="share-figures">
              <span>max profit <b className="num text-profit">{fmtMoney(r.maxProfit, a.money, { signed: true, unlimited: "Unlimited" })}</b></span>
              <span>max loss <b className="num text-loss">{fmtMoney(r.maxLoss, a.money, { signed: true, unlimited: "Unlimited" })}</b></span>
              <span>POP <b className="num">{Number.isFinite(r.pop) ? `${(r.pop * 100).toFixed(0)}%` : "—"}</b></span>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

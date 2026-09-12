"use client";
// Share a public trader page (ADR-075; HC-PB-067): X and Telegram intent links, copy the link, download the PNG card.
// No keys, no SDKs: intents open in a new tab and the card is drawn on a canvas in the browser.
import type { PublicTraderPage } from "@hapiecoin/schema";
import { Button, Copy, toast } from "@hapiecoin/ui";
import { useMemo } from "react";
import type { MoneyFormat } from "@/lib/money";
import { cardFigures, shareCardPng, shareText, telegramShareUrl, xShareUrl } from "@/lib/public/share";
import { copyText } from "@/lib/strategy/journal";

export function ShareBar({ page, url, money, compact = false }: { page: PublicTraderPage; url: string; money: MoneyFormat; compact?: boolean }) {
  const text = useMemo(() => shareText(page, url, money), [page, url, money]);
  const copy = async () => {
    const ok = await copyText(url);
    if (ok) toast("Link copied", { description: url });
    else toast.error("Could not copy", { description: "Select the link and copy it by hand" });
  };
  const download = () => {
    const png = shareCardPng(cardFigures(page, url, money));
    if (!png) {
      toast.error("Could not draw the card", { description: "This browser has no canvas" });
      return;
    }
    const a = document.createElement("a");
    a.href = png;
    a.download = `hapiecoin-${page.handle}-verified-pnl.png`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Card saved", { description: a.download });
  };
  const size = compact ? "sm" : "md";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="share-bar">
      <Button size={size} variant="outline" asChild>
        <a href={xShareUrl(text)} target="_blank" rel="noopener noreferrer" data-testid="share-x">
          Post on X
        </a>
      </Button>
      <Button size={size} variant="outline" asChild>
        <a href={telegramShareUrl(url, text)} target="_blank" rel="noopener noreferrer" data-testid="share-telegram">
          Send on Telegram
        </a>
      </Button>
      <Button size={size} variant="outline" onClick={() => void copy()} data-testid="share-copy-link">
        <Copy className="size-3.5" aria-hidden="true" /> Copy link
      </Button>
      <Button size={size} variant="outline" onClick={download} data-testid="share-image">
        Download image
      </Button>
    </div>
  );
}

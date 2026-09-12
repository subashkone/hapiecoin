// Sharing a public page (ADR-075; HC-PB-067): the text, the intent links and the card figures, and that the card drawing
// puts every figure and the link on the canvas.
import type { PublicTraderPage } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { CARD_H, CARD_W, cardFigures, drawShareCard, pageUrl, shareText, telegramShareUrl, xShareUrl } from "./share";

const page: PublicTraderPage = {
  handle: "asha_trades",
  name: "Asha",
  total: { all: "1.65", d7: "1.65", d30: "-2.5" },
  fills: 2,
  since: "2026-09-10T09:00:00.000Z",
  lastReadAt: "2026-09-12T08:00:00.000Z",
  days: null,
  accounts: null,
  months: null,
  partial: false,
};

describe("HC-PB-067 share text and links", () => {
  it("names the 30-day figure net of fees and the page link; X and Telegram get it URL-encoded", () => {
    const url = pageUrl("https://hapiecoin.com", "asha_trades");
    expect(url).toBe("https://hapiecoin.com/t/asha_trades");
    const text = shareText(page, url);
    expect(text).toBe("My verified options P&L on HapieCoin: \u2212$2.50 over the last 30 days (net of fees, from exchange fills). https://hapiecoin.com/t/asha_trades");
    expect(xShareUrl(text)).toBe(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
    expect(telegramShareUrl(url, text)).toBe(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  });

  it("the card carries the name, handle, three figures, the fill count, since when and the link", () => {
    const fig = cardFigures(page, "https://hapiecoin.com/t/asha_trades");
    expect(fig).toEqual({ handle: "@asha_trades", name: "Asha", all: "+$1.65", d7: "+$1.65", d30: "\u2212$2.50", fills: "2 fills", since: "since 2026-09-10", url: "https://hapiecoin.com/t/asha_trades" });
    const texts: string[] = [];
    const rects: [number, number, number, number][] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop) => {
        if (prop === "fillText") return (s: string) => texts.push(s);
        if (prop === "fillRect") return (...a: [number, number, number, number]) => rects.push(a);
        return () => undefined;
      },
      set: () => true,
    });
    drawShareCard(ctx, fig);
    expect(rects[0]).toEqual([0, 0, CARD_W, CARD_H]); // the background covers the card
    for (const v of ["HapieCoin · Verified P&L", "Asha", "@asha_trades", "+$1.65", "\u2212$2.50", "https://hapiecoin.com/t/asha_trades"]) expect(texts).toContain(v);
    expect(texts.join(" ")).toContain("2 fills · since 2026-09-10 · net of fees");
    expect(cardFigures({ ...page, fills: 0, since: null }, "u").since).toBe("no fills yet");
  });
});

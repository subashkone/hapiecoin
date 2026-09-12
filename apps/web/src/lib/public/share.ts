// Sharing a public trader page (ADR-075; HC-PB-067): the message, the X and Telegram intent links (no keys, no SDKs),
// and the 1200×630 card drawn on a canvas so the trader can post an image anywhere.
import type { PublicTraderPage } from "@hapiecoin/schema";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";

export const CARD_W = 1200;
export const CARD_H = 630;

export const pageUrl = (origin: string, handle: string): string => `${origin}/t/${handle}`;

/** The line a trader posts: the 30-day figure, net of fees, and the link. */
export function shareText(page: PublicTraderPage, url: string, money: MoneyFormat = USD): string {
  const d30 = fmtMoney(Number(page.total.d30), money, { signed: true });
  return `My verified options P&L on HapieCoin: ${d30} over the last 30 days (net of fees, from exchange fills). ${url}`;
}

const enc = encodeURIComponent;
export const xShareUrl = (text: string): string => `https://twitter.com/intent/tweet?text=${enc(text)}`;
export const telegramShareUrl = (url: string, text: string): string => `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`;

export interface CardFigures {
  handle: string;
  name: string;
  all: string;
  d7: string;
  d30: string;
  fills: string;
  since: string;
  url: string;
}

/** The figures as they appear on the card, formatted once here so the drawing and its test agree. */
export function cardFigures(page: PublicTraderPage, url: string, money: MoneyFormat = USD): CardFigures {
  const m = (v: string) => fmtMoney(Number(v), money, { signed: true });
  return {
    handle: `@${page.handle}`,
    name: page.name,
    all: m(page.total.all),
    d7: m(page.total.d7),
    d30: m(page.total.d30),
    fills: `${page.fills} ${page.fills === 1 ? "fill" : "fills"}`,
    since: page.since ? `since ${page.since.slice(0, 10)}` : "no fills yet",
    url,
  };
}

/** Draws the share card. Pure drawing on the given context so a test can pass a recording stub. */
export function drawShareCard(ctx: CanvasRenderingContext2D, fig: CardFigures): void {
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "#f5b84a";
  ctx.fillRect(0, 0, CARD_W, 10);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f5b84a";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText("HapieCoin · Verified P&L", 72, 96);
  ctx.fillStyle = "#e8ebf2";
  ctx.font = "bold 52px system-ui, sans-serif";
  ctx.fillText(fig.name, 72, 176);
  ctx.fillStyle = "#8b93a7";
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText(fig.handle, 72, 222);
  const tiles: [string, string][] = [
    ["Last 30 days", fig.d30],
    ["Last 7 days", fig.d7],
    ["All time", fig.all],
  ];
  tiles.forEach(([label, value], i) => {
    const x = 72 + i * 360;
    ctx.fillStyle = "#151925";
    ctx.fillRect(x, 280, 328, 170);
    ctx.fillStyle = "#8b93a7";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(label, x + 28, 330);
    ctx.fillStyle = /^[-\u2212]/.test(value) ? "#ef5b5b" : value.startsWith("+") ? "#2ecc71" : "#e8ebf2";
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillText(value, x + 28, 412);
  });
  ctx.fillStyle = "#8b93a7";
  ctx.font = "26px system-ui, sans-serif";
  ctx.fillText(`${fig.fills} · ${fig.since} · net of fees, from exchange fills`, 72, 520);
  ctx.fillStyle = "#e8ebf2";
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillText(fig.url, 72, 574);
}

/** Renders the card to a PNG data URL; null where canvas is unavailable (jsdom, old browsers). */
export function shareCardPng(fig: CardFigures, doc: Document = document): string | null {
  const canvas = doc.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawShareCard(ctx, fig);
  return canvas.toDataURL("image/png");
}

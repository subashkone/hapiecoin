// Public home page copy (ADR-140). HapieCoin's own words, in the order a trade happens: build, protect, review, then
// Autopilot and safety. Every claim names something the product does; the pictures are the product itself with sample
// trades (apps/web/public/shots). Server-safe: plain data; the template count is read from the catalogue so the copy
// never drifts from it (ADR-060).
import { publicEnv } from "@/lib/env";
import { TEMPLATE_COUNT } from "@/lib/strategy/templates";

export const HERO = {
  eyebrow: "Crypto options · Indian exchanges",
  title: "Know your worst case before you place the trade.",
  lede: "HapieCoin is a desk for BTC, ETH and gold options. Build a strategy, see what it can make and lose, practise it on paper, and let stop and target rules watch it for you.",
  note: "Connected today: Delta Exchange India. Options trading carries risk of loss.",
} as const;

/** A product picture: `shots/<name>-dark.png` and `-light.png`. A whole screen is 2000 x 1250; a dialog gives its own size. */
export interface Shot {
  name: string;
  alt: string;
  /** Pixel size of the files, when it is not a whole screen. */
  size?: { w: number; h: number };
}

export const HERO_SHOT: Shot = { name: "paper", alt: "The HapieCoin Desk: a sample BTC iron condor on paper with its stop and target, and its payoff chart with both break-evens" };

export const STEPS: readonly { id: string; step: string; title: string; body: string; points: readonly string[]; shot: Shot }[] = [
  {
    id: "build",
    step: "1 · Build",
    title: "Pick the strikes, see the payoff.",
    body: `A live options chain with every strike the exchange lists. Add legs by hand or start from ${TEMPLATE_COUNT} ready templates.`,
    points: ["Most you can make, most you can lose and both break-evens", "Fees and estimated margin before you trade", "Greeks, scenarios and volatility beside the chart"],
    shot: { name: "build", alt: "The Builder with a four-leg iron condor: premium, fees, margin estimate and the payoff chart" },
  },
  {
    id: "protect",
    step: "2 · Protect",
    title: "Set the exits before you enter.",
    body: "Give a trade its stop and its target when you open it. The rules run on our servers, so they work with your browser closed.",
    points: ["Stop loss and target for the whole strategy", "A target that trails your best profit, or takes profit in steps", "A stop on one leg, a spot level and a time exit"],
    shot: { name: "protect", alt: "The Protect dialog: stop loss, target with a trail, take profit in steps, leg stops and a time exit", size: { w: 800, h: 1150 } },
  },
] as const;

export const REVIEW = {
  step: "3 · Review",
  title: "Learn from every closed trade.",
  points: [
    { title: "Journal", body: "Every paper and live trade with its notes, tags and the reason it closed." },
    { title: "Backtest and replay", body: "Run a strategy on past option prices, or step through a past day." },
    { title: "Verified P&L", body: "Your live results checked against the exchange's own fills." },
  ],
} as const;

export const AUTOPILOT = {
  title: "Autopilot trades your strategies for you, with the exits attached.",
  lede: "Switch on the strategies you want. Autopilot watches the market, enters when a strategy's own conditions are met and stays out when they are not. Today it trades on paper with live prices; live trading on your exchange comes next.",
  points: [
    { title: "Paper first", body: "Today it places no real orders. Live trading comes next." },
    { title: "Every trade has an exit", body: "Stop, target or trail from the moment it opens." },
    { title: "You stay in charge", body: "Exit one trade, switch a strategy off, or stop everything." },
    { title: "Every decision is logged", body: "Entries, exits and the trades it skipped, with the reason." },
  ],
  shot: { name: "autopilot", alt: "The Autopilot screen: five sample paper trades, each with its health and its profit or loss now" } satisfies Shot,
} as const;

export const SAFETY = [
  { title: "Paper before live", body: "Every strategy can run on paper with live prices first." },
  { title: "You type LIVE to go live", body: "A real order needs a typed confirmation, and a second factor when you turn it on." },
  { title: "Margin shown first", body: "You see the estimated margin and the fees before anything is sent." },
  { title: "Keys stay encrypted", body: "Your exchange API key is stored encrypted and is never shown again after you save it." },
] as const;

export const EXCHANGES = [{ name: "Delta Exchange India", status: "live", mark: "Δ" }] as const;

export const AUTH_FEATURES = [
  { icon: "barchart", title: "See the worst case first", desc: "Payoff, break-evens, fees and margin before you trade" },
  { icon: "shield", title: "Practise on paper", desc: "The same screens and rules, with live prices" },
  { icon: "zap", title: "Exits that keep watching", desc: "Stops, targets and trails run on our servers" },
  { icon: "trending", title: "Learn from every trade", desc: "Journal, backtest and replay" },
] as const;

/**
 * ADR-140: whether plans can be bought. Off until the pricing is decided: the home page says "coming soon", the plan
 * page shows no prices and no way to pay (an admin still sees everything), and access is granted by hand from the admin
 * screen. One switch, read from the environment (`NEXT_PUBLIC_PLANS_ON_SALE`, off unless it says "true"), so sales are
 * turned on at deploy time without a code change; the end-to-end stack runs with it on, so the buying flow stays tested.
 */
export const PLANS_ON_SALE: boolean = publicEnv().NEXT_PUBLIC_PLANS_ON_SALE === "true";

export const SUPPORT_EMAIL = "support@hapiecoin.com";
export const SUPPORT_WHATSAPP = { href: "https://wa.me/919684022369", label: "+91 96840 22369" };

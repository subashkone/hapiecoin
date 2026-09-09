// Product tour data and events (HC-SH-064..076; ADR-036; docs/design/chrome.md). Steps point at `[data-tour=…]`
// anchors; some advance on an app event (a leg added, the save dialog opening, the paper trade starting) so the
// trader does the real thing rather than reading about it. The tour runs only on /analyse.
import type { WorkspaceTab } from "@/lib/store";

export type TourEvent = "leg-added" | "trade-mode-open" | "save-dialog-open" | "trade-preview-open" | "paper-started";
const EVENT_PREFIX = "hc-tour:";

export interface TourStep {
  title: string;
  desc: string;
  /** Anchor `data-tour` value; none = centred popover. */
  target?: string;
  /** Fallback anchor when the target is not on screen. */
  alt?: string;
  /** Workspace tab to show for this step. */
  tab?: WorkspaceTab;
  /** App events that advance the tour, each with how many steps to jump (a skipped dialog jumps two); Next still works. */
  waitFor?: Partial<Record<TourEvent, number>>;
  next?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { title: "Welcome to HapieCoin", desc: "Let's place a paper trade together, from picking legs to stopping the trade. Skip anytime; replay later from Settings → Take a tour.", next: "Start" },
  { target: "asset-select", title: "Choose your asset", desc: "Switch between BTC, ETH and XAUT. The live futures price and the feed state update here in real time." },
  { target: "options-chain", title: "Your workspaces", desc: "Chain shows live strikes from the venue. Builder shapes strategies. Paper and Live hold your trades, and Journal keeps the record.", tab: "chain" },
  { target: "options-chain", title: "Add a leg · try it now", desc: "Hover a strike in the chain and press B or S (or use the row's Buy / Sell buttons) to add it as a leg. The tour moves on as soon as your first leg is in.", tab: "chain", waitFor: { "leg-added": 1 } },
  { target: "strategy-legs", alt: "add-leg-button", title: "Your strategy legs", desc: "Here is the leg you just added. Change side, strike, expiry and lots in place, or add more legs for a multi-leg strategy. Press Next when it looks right.", tab: "builder" },
  { target: "payoff-panel", title: "Payoff and analytics", desc: "The payoff diagram, max profit, max loss, breakevens and probability of profit follow the legs you are building." },
  { target: "paper-trade-button", title: "Start a paper trade", desc: "Click Paper Trade to begin. Simulated positions at live prices, no real orders.", tab: "builder", waitFor: { "trade-mode-open": 1 } },
  { target: "trade-modal", alt: "trade-confirm-button", title: "Paper or Live", desc: "Paper is selected. Live needs a connected exchange key and places real orders. Keep Paper, pick the broker and press Continue.", waitFor: { "trade-preview-open": 1 } },
  { target: "trade-preview", alt: "trade-confirm-button", title: "Review and start", desc: "Check the preview: legs, net premium, fees and margin. Then press Trade now. An unnamed strategy asks for a name first.", waitFor: { "save-dialog-open": 1, "paper-started": 2 } },
  { target: "save-dialog", title: "Name your strategy", desc: "Give the trade a name you will recognise in the list, then continue.", waitFor: { "paper-started": 1 } },
  { target: "paper-tab", title: "Your trade is running", desc: "Every paper trade lives in the Paper tab, including the one you just started.", tab: "paper" },
  { target: "paper-pnl", title: "Track P&L and details", desc: "Total P&L updates live as the market moves. Open Details for per-leg P&L, the payoff chart and history.", tab: "paper" },
  { target: "paper-stop", title: "Stop a paper trade", desc: "Use Stop when you are done. Choose whether to archive it so the result stays in your journal.", tab: "paper" },
  { target: "settings-menu", title: "Settings", desc: "Profile, subscription, API key, currency, lot sizes, density and this tour all live under the gear." },
  { target: "chat-launcher", title: "Ask the HapieCoin Assistant", desc: "Stuck anywhere? This chat button answers questions about screens and options concepts, and 'Explain this strategy' summarises your current legs. Drag it wherever you like." },
  { target: "command-palette", title: "Command palette", desc: "Press Ctrl K (⌘ K on Mac) anywhere to jump to a screen, switch asset, toggle theme or density, or replay this tour. Just start typing." },
];

/** Browser flag: the tour has run (or was skipped) here (HC-SH-076). Its own key so clearing the UI store keeps it. */
export const TOUR_DONE_KEY = "hapiecoin.tour";
export function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "done";
  } catch {
    return true; // no storage: never auto-start
  }
}
export function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, "done");
  } catch {
    /* storage blocked */
  }
}

/** Fire an app event the tour may be waiting for (safe on the server). */
export function emitTour(event: TourEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${event}`));
}
export function onTourEvent(event: TourEvent, handler: () => void): () => void {
  const name = `${EVENT_PREFIX}${event}`;
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
/** The first visible anchor for a step, trying the alternate when the main one is off screen. */
export function findTourTarget(step: TourStep, root: ParentNode = document): HTMLElement | null {
  const pick = (key: string): HTMLElement | null => {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) if (visible(el)) return el;
    return null;
  };
  if (!step.target) return null;
  return pick(step.target) ?? (step.alt ? pick(step.alt) : null);
}

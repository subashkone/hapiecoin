// HapieCoin Assistant answers (HC-SH-060, 061, 110, 111; ADR-036): keyword-matched platform help written for this
// product, plus a strategy explainer built from the live analysis. Platform help only, never financial advice.
import { TEMPLATE_COUNT } from "./strategy/templates";
import type { AnalyzeResult } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { type MoneyFormat, fmtMoney } from "@/lib/money";

export const EXPLAIN_QUESTION = "Explain this strategy";
export const BASE_SUGGESTIONS = ["How do I add a leg from the chain?", "What is probability of profit?", "How do I connect Delta Exchange?", "Difference between mark and bid/ask P&L?"] as const;
export function suggestionsFor(onAnalyse: boolean): string[] {
  return onAnalyse ? [EXPLAIN_QUESTION, ...BASE_SUGGESTIONS.slice(0, 3)] : [...BASE_SUGGESTIONS];
}

interface Answer {
  match: RegExp;
  text: string;
}
/** Keyword answers, most specific first. Wording is HapieCoin's own. */
export const ANSWERS: readonly Answer[] = [
  { match: /probab|\bpop\b/i, text: "Probability of profit (POP) is the estimated chance that the strategy finishes above breakeven at the nearest expiry. HapieCoin derives it from the current futures price, the ATM implied volatility and the days to expiry under a lognormal model. Above 60 % reads as high, 40 to 60 % moderate, below 40 % low. It is a statistical estimate, not a promise." },
  { match: /\bmark\b|bid|ask|basis|realis|realiz/i, text: "Mark price P&L uses the venue's mark, the same figure Delta Exchange shows. Bid/ask P&L uses what you would actually get closing right now: long legs at the bid, short legs at the ask. The two differ by roughly the spread, more on thin strikes. Switch the basis in Settings → P&L Settings." },
  { match: /connect|delta exchange|api key|\bapi\b|secret|whitelist|exchange setup/i, text: "Open Settings (gear) → API Settings. Create an API key on Delta Exchange India (Account → API keys), whitelist HapieCoin's egress IP shown in the dialog, then paste the key and secret and press Connect. Once connected the header shows your wallet and the Live tab can place real orders after a confirm step." },
  { match: /\bleg|chain|strike|\badd\b/i, text: "Open the Chain tab, hover a strike and press B (buy) or S (sell), or use the row's Buy / Sell buttons. Pick lots first if you need more than the default. The leg appears in the Builder, where you can change side, strike, expiry and lots in place. Up to 10 legs; the payoff pane updates as you go." },
  { match: /paper|virtual|square|\bstop\b/i, text: "Build your legs, then click Paper Trade in the Builder. Name the strategy, review the preview (legs, net premium, margin) and start. The trade sits in the Paper tab with live P&L; open Details for per-leg P&L, or Stop to square everything off at the current price and keep the result in your journal. No real orders are placed." },
  { match: /live trad|real order|go live|place order/i, text: "Live trading needs a connected Delta Exchange API key and an explicit switch to Live in the trade dialog, then a confirm step. HapieCoin shows the venue's margin in the preview, places the orders through the live executor with a client order id per leg, and keeps the Live tab in sync with the venue. Every action is written to the audit log." },
  { match: /alert|notify|telegram|push/i, text: "Alerts arrive in Phase 5 with price, IV rank and strategy P&L rules delivered by push, email or Telegram. For now the Paper and Live tabs show live P&L, and the portfolio bar keeps the net across strategies in view." },
  { match: /shortcut|keyboard|palette|ctrl|command/i, text: "Press Ctrl K (⌘ K on Mac) anywhere for the command palette: jump to a screen, switch asset, toggle theme or density, copy your referral link, show announcements or replay the tour. In the chain, B and S add legs on the hovered strike, Enter opens option details, Esc closes dialogs." },
  { match: /template|iron|condor|straddle|strangle|spread|butterfly|lizard/i, text: `The templates strip above the Builder holds ${TEMPLATE_COUNT} ready-made setups grouped by bullish, bearish, neutral and others. Click one to load its legs at the current ATM strike, then edit strikes, expiry and lots before trading. Bull Call Spread, Iron Condor, Straddle, Strangle, Butterfly and Jade Lizard are all there.` },
  { match: /greek|\bdelta\b|theta|vega|gamma/i, text: "The Greeks tab shows net and per-leg Greeks. Delta is the P&L change per one point move in the futures price, Gamma how fast Delta changes, Theta the daily time decay, Vega the sensitivity to a one point change in implied volatility. Multi-leg strategies net them across legs." },
  { match: /margin|capital|collateral/i, text: "Margin in the live preview is what Delta Exchange reports for the order; paper trades show an estimate. Long options need only the premium, short options need initial margin on the notional, and spreads get a margin benefit. Delta has no pre-trade margin estimate endpoint, so the live figure appears after the venue answers." },
  { match: /\blot|quantity|size|density|compact/i, text: "One lot is the venue's contract size: 0.001 BTC, 0.01 ETH and 0.001 XAUT by default; change them in Settings → Lot Size Settings. Lots in the chain default to 100 and every leg carries its own count. Prefer tighter tables? Toggle Density from the gear or press D." },
  { match: /plan|subscri|upgrade|renew|coupon|referr|invoice|payment/i, text: "Plans live under Subscription: Free includes the live chain, the builder and a few paper trades a month; Basic, Pro and Elite add more paper trades, live trading, analytics and exports. Pay with Razorpay, apply a coupon in the Subscribe dialog, and find invoices in Payment History. Your referral code under Referrals earns commission on every paid sign-up." },
  { match: /currency|inr|usd|rupee/i, text: "The currency toggle in the header switches the display between USD and INR. P&L, margin and net premium are converted at the rate in Currency Settings; chain prices stay in USD as the venue quotes them." },
  { match: /expiry|expire|dte|days to/i, text: "Expiries come from the venue's instrument list, never a fixed step. Pick one in the chain header; each leg can carry its own expiry for calendars. The target-date slider in the payoff pane shows P&L on a date before expiry." },
];
export const FALLBACK = "I can help with using HapieCoin: the options chain, building strategies, paper and live trades, Greeks, plans and settings. Try one of the suggestions above, or email support@hapiecoin.com for anything else.";
export const VISITOR_NOTE = "You are in visitor mode. I can explain how HapieCoin works; sign in for help with your own strategies and trades.";

export function answerFor(question: string, opts: { loggedIn: boolean; explain?: (() => string) | undefined }): string {
  const q = question.trim();
  let text: string;
  if (/explain|summar|this strategy|my strategy|what am i holding/i.test(q)) text = opts.explain ? opts.explain() : "Open the Analyse workspace and ask again; the explainer reads the legs in your Builder.";
  else text = ANSWERS.find((a) => a.match.test(q))?.text ?? FALLBACK;
  return opts.loggedIn ? text : `${text}\n\n${VISITOR_NOTE}`;
}

const legLine = (l: StrategyLeg): string => `${l.side === "buy" ? "Buy" : "Sell"} ${l.lots} × ${fmtStrike(l.strike)} ${l.kind === "call" ? "Call" : l.kind === "put" ? "Put" : "Future"} · ${fmtExpiry(l.expiry)}`;

/** A plain-language summary of the current legs from the live analysis (HC-SH-110). */
export function explainStrategy(input: { asset: Underlying; name: string; legs: readonly StrategyLeg[]; result: AnalyzeResult | null; spot: number | null; money: MoneyFormat }): string {
  const { legs, result: r, money } = input;
  if (legs.length === 0) return "There are no legs in the Builder yet. Hover a strike in the chain and press B or S to add one, then ask me again and I will summarise max profit, max loss, breakevens and probability of profit.";
  if (!r) return "I could not price this strategy right now. Try again after the next tick.";
  const name = input.name || `${legs.length}-leg strategy`;
  const mp = Number.isFinite(r.maxProfit) ? fmtMoney(r.maxProfit, money, { signed: true }) : "unlimited";
  const ml = Number.isFinite(r.maxLoss) ? fmtMoney(r.maxLoss, money, { signed: true }) : "unlimited";
  const spot = input.spot ?? 0;
  const be = r.breakevens.length ? r.breakevens.map((b) => `${fmtStrike(String(b))}${spot > 0 ? ` (${((b / spot - 1) * 100).toFixed(1)} % from spot)` : ""}`).join(" and ") : "none; the position is entirely in profit or in loss at expiry";
  const prem = r.netPremium >= 0 ? `You collect a net credit of ${fmtMoney(r.netPremium, money)}` : `You pay a net debit of ${fmtMoney(-r.netPremium, money)}`;
  const pop = Number.isFinite(r.pop) ? `${Math.round(r.pop * 100)} %` : "unknown without an IV";
  const risk = !Number.isFinite(r.maxLoss) ? "risk is open-ended, so size it carefully" : Number.isFinite(r.maxProfit) ? "both risk and reward are capped" : "risk is capped while reward is open-ended";
  const theta = r.greeks.theta >= 0 ? "time decay works for you" : "time decay works against you";
  const bias = Math.abs(r.greeks.delta) < 0.05 ? "neutral" : r.greeks.delta > 0 ? "bullish" : "bearish";
  return [
    `${name} on ${input.asset} · ${legs.length} ${legs.length === 1 ? "leg" : "legs"}${spot > 0 ? ` · spot ${fmtStrike(String(spot))}` : ""}`,
    ...legs.map((l) => `• ${legLine(l)}`),
    "",
    `${prem}. Max profit ${mp}, max loss ${ml}. Breakeven${r.breakevens.length > 1 ? "s" : ""}: ${be}. Probability of profit ${pop}.`,
    "",
    `Greeks now: Δ ${r.greeks.delta.toFixed(3)}, Θ ${fmtMoney(r.greeks.theta, money, { signed: true })} per day, ν ${fmtMoney(r.greeks.vega, money, { signed: true })} per 1 % IV.`,
    "",
    `Read: ${bias} bias; ${risk}; ${theta}. Platform help, not financial advice.`,
  ].join("\n");
}

// Assistant answers (HC-SH-060, 061, 110, 111): keyword routing, the visitor note, and the strategy explainer.
import type { AnalyzeResult } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { USD } from "@/lib/money";
import { ANSWERS, BASE_SUGGESTIONS, EXPLAIN_QUESTION, FALLBACK, VISITOR_NOTE, answerFor, explainStrategy, suggestionsFor } from "./assistant";

const leg = (over: Partial<StrategyLeg> = {}): StrategyLeg => ({ id: "l1", asset: "BTC", kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", lots: 10, price: "1200", symbol: "C-BTC-80000-250926", status: "open", createdAt: 1, ...over });
const result = (over: Partial<AnalyzeResult> = {}): AnalyzeResult => ({
  maxProfit: 500,
  maxLoss: -120,
  breakevens: [81200],
  netPremium: -120,
  pop: 0.42,
  greeks: { delta: 0.35, gamma: 0.0001, theta: -3.2, vega: 8.1, rho: 0 },
  expectedMove: 1500,
  rewardRisk: 4.1,
  daysToNearestExpiry: 12,
  atmIv: 0.5,
  ...over,
} as AnalyzeResult);

describe("HC-SH-060 / HC-SH-061 answers", () => {
  it("routes each keyword to its answer, falls back, and never names a competitor", () => {
    expect(answerFor("What is probability of profit?", { loggedIn: true })).toContain("Probability of profit");
    expect(answerFor("mark vs bid ask", { loggedIn: true })).toContain("Bid/ask");
    expect(answerFor("How do I connect Delta Exchange?", { loggedIn: true })).toContain("API Settings");
    expect(answerFor("How do I add a leg from the chain?", { loggedIn: true })).toContain("press B");
    expect(answerFor("start a paper trade", { loggedIn: true })).toContain("No real orders");
    expect(answerFor("shortcuts?", { loggedIn: true })).toContain("Ctrl K");
    expect(answerFor("iron condor template", { loggedIn: true })).toContain("templates strip");
    expect(answerFor("what is theta", { loggedIn: true })).toContain("Theta");
    expect(answerFor("how much margin", { loggedIn: true })).toContain("Margin");
    expect(answerFor("lot size", { loggedIn: true })).toContain("0.001 BTC");
    expect(answerFor("upgrade my plan", { loggedIn: true })).toContain("Razorpay");
    expect(answerFor("show in INR", { loggedIn: true })).toContain("currency toggle");
    expect(answerFor("which expiry", { loggedIn: true })).toContain("instrument list");
    expect(answerFor("alerts?", { loggedIn: true })).toContain("Alerts");
    expect(answerFor("go live", { loggedIn: true })).toContain("Live trading");
    expect(answerFor("zzz nothing", { loggedIn: true })).toBe(FALLBACK);
    for (const a of ANSWERS) expect(a.text).not.toMatch(/coin\s?greeks/i);
  });

  it("appends the visitor note when signed out and routes explain questions", () => {
    expect(answerFor("what is pop", { loggedIn: false })).toContain(VISITOR_NOTE);
    expect(answerFor(EXPLAIN_QUESTION, { loggedIn: true, explain: () => "EXPLAINED" })).toBe("EXPLAINED");
    expect(answerFor("summarise my strategy", { loggedIn: true })).toContain("Open the Analyse workspace");
    expect(answerFor("   ", { loggedIn: true })).toBe(FALLBACK);
  });

  it("suggests the explainer first on Analyse and the base chips elsewhere", () => {
    expect(suggestionsFor(true)[0]).toBe(EXPLAIN_QUESTION);
    expect(suggestionsFor(false)).toEqual([...BASE_SUGGESTIONS]);
  });
});

describe("HC-SH-110 explainStrategy", () => {
  const base = { asset: "BTC" as const, name: "", spot: 80000, money: USD };
  it("guides when there are no legs or no result", () => {
    expect(explainStrategy({ ...base, legs: [], result: null })).toContain("no legs");
    expect(explainStrategy({ ...base, legs: [leg()], result: null })).toContain("could not price");
  });

  it("describes a debit call: legs, breakeven with % from spot, capped/uncapped, bias and theta", () => {
    const text = explainStrategy({ ...base, name: "Long Call", legs: [leg()], result: result() });
    expect(text).toContain("Long Call on BTC · 1 leg · spot 80,000");
    expect(text).toContain("• Buy 10 × 80,000 Call · 25 Sep");
    expect(text).toContain("You pay a net debit of $120.00");
    expect(text).toContain("Breakeven: 81,200 (1.5 % from spot)");
    expect(text).toContain("Probability of profit 42 %");
    expect(text).toContain("bullish bias; both risk and reward are capped; time decay works against you");
    expect(text).toContain("not financial advice");
  });

  it("handles credit, unlimited profit/loss, no breakevens, neutral bias and no spot", () => {
    const legs = [leg({ side: "sell", kind: "put" }), leg({ id: "l2", side: "sell", kind: "future" })];
    const text = explainStrategy({ ...base, spot: null, legs, result: result({ maxProfit: Infinity, maxLoss: -Infinity, breakevens: [], netPremium: 300, greeks: { delta: 0.01, gamma: 0, theta: 2, vega: 1, rho: 0 }, pop: NaN }) });
    expect(text).toContain("2-leg strategy on BTC · 2 legs");
    expect(text).toContain("Sell 10 × 80,000 Put");
    expect(text).toContain("Future");
    expect(text).toContain("You collect a net credit of $300.00");
    expect(text).toContain("Max profit unlimited, max loss unlimited");
    expect(text).toContain("Breakeven: none");
    expect(text).toContain("unknown without an IV");
    expect(text).toContain("neutral bias; risk is open-ended");
    expect(text).toContain("time decay works for you");
    const capped = explainStrategy({ ...base, legs, result: result({ maxProfit: Infinity, maxLoss: -50, breakevens: [79000, 81000], greeks: { delta: -0.4, gamma: 0, theta: -1, vega: 1, rho: 0 } }) });
    expect(capped).toContain("Breakevens: 79,000 (-1.2 % from spot) and 81,000 (1.2 % from spot)");
    expect(capped).toContain("bearish bias; risk is capped while reward is open-ended");
  });
});

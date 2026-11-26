// One Autopilot trade replayed over recorded prices (ADR-144; HC-TR-286). Pure: no database, no clock, no network.
//
// Given the legs of an entry, the plan the engine made for it (`clockPlanFor` / `savedPlanFor`) and the marks of its
// legs bar by bar, this walks the bars and applies the exits the live trade would carry: the rules `enter()` writes in
// autopilot.ts, judged the way `evaluateRules` judges them in rules-engine.ts, with the helpers both of those use
// (the trail floors, the share a step closes, the order the kinds are judged in). What is left at the expiry settles
// at its intrinsic value. Fees are the exchange's rule on every fill and on a settlement in the money.
//
// What a replay is NOT, and every figure made from it has to say so:
// - fills are at the bar's mark: no bid / ask, no slippage;
// - a bar is one price (5 minutes or an hour apart), where the live engine looks every two seconds: a level crossed
//   and uncrossed inside a bar is not seen, and an exit is booked at the bar's price, not at the level;
// - a bar in which an open leg has no mark is skipped whole, as the live engine skips such a tick; a mark that is not
//   a number above zero counts as none (in a candle series that is a hole, not a price);
// - what happens on one bar happens in the order the rules are judged: two sold options stopped on the same bar are
//   stopped one after the other, and the trail on the rest counts from the first.
// Only a plan of a playbook entered by the clock or of a saved strategy is replayed (`clockPlanFor`, `savedPlanFor`):
// the built-in trend playbooks take their exit style from the trader, which this has no input for.
// Every close is booked in whole cents, as the paper book books it (`realizedPnl`), so a level judged on the total is
// judged on the same total.
// PAPER ONLY: nothing here can place an order.
import { type FeeRule, fillFee, settlementFee } from "@hapiecoin/pricing";
import { CLOSE_REASON_OF_KIND, type CloseReason, RULE_KIND_ORDER, type RuleKind, openProfitPct, restTrailFloorUsd, stepLots, toDecimal, trailFloorUsd } from "@hapiecoin/schema";
import { type AutopilotPlan, nextHourUtc } from "./autopilot.js";

export interface SimLeg {
  kind: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  lots: number;
  /** The entry fill, per unit of the underlying. */
  price: number;
}
export interface SimBar {
  /** Epoch ms. */
  ts: number;
  /** The mark of each leg at this bar, in the order of the legs; null when the venue recorded none. */
  marks: readonly (number | null)[];
  /** The underlying at this bar (the notional of a fill's fee); null: the entry's spot stands in. */
  spot: number | null;
}
export interface SimInput {
  legs: readonly SimLeg[];
  plan: AutopilotPlan;
  /** Units of the underlying in one lot. */
  unitsPerLot: number;
  /** The exchange's fee rule; null: no fees are counted. */
  feeRule: FeeRule | null;
  entryMs: number;
  entrySpot: number;
  /** When the legs' expiry settles, and the underlying then. */
  settleMs: number;
  settleSpot: number;
  /** Bars after the entry and before the settlement, oldest first. Others are ignored. */
  bars: readonly SimBar[];
}
export interface SimEvent {
  ts: number;
  kind: RuleKind | "settled";
  /** What was closed: the leg's index, the lots and the price. */
  closed: { leg: number; lots: number; price: number }[];
  /** The trade's P&L before fees right after this event (realised plus what is still open at this bar's marks). */
  pnl: number;
}
export interface SimResult {
  /** P&L before fees, fees and tax of every fill and settlement, and the two netted. USD. */
  gross: number;
  fees: number;
  net: number;
  /** When the last leg was closed, and why the trade ended. */
  closedMs: number;
  reason: CloseReason;
  events: SimEvent[];
  /** Bars in which an open leg had no mark: nothing was judged on them. */
  barsSkipped: number;
  /** Bars the trade was judged on. */
  barsJudged: number;
}

interface Rule {
  kind: RuleKind;
  /** Which `time` rule: an instant or days to expiry. */
  trigger?: "at" | "dte";
  level: number;
  /** A lock's arming level. */
  value?: number;
  leg?: number;
  /** Give-back in per cent: a trailing target, or the trail a leg stop starts on the rest. */
  trailPct?: number;
  closeShare?: number;
  peak: number | null;
  armed: boolean;
}

const sign = (side: "buy" | "sell") => (side === "buy" ? 1 : -1);
const cents = (n: number): number => Number(toDecimal(n, 2));
/** A best in whole cents rounded down, as the live rule stores it. */
const seenOf = (n: number): number => Math.floor(n * 100 + 1e-6) / 100;

/** The rules of an entry, as `enter()` writes them from the plan. */
function rulesOf(legs: readonly SimLeg[], plan: AutopilotPlan, entryMs: number): Rule[] {
  const rules: Rule[] = [];
  const add = (r: Omit<Rule, "peak" | "armed">) => rules.push({ ...r, peak: null, armed: true });
  if (plan.targetUsd !== null) add({ kind: "target", level: cents(plan.targetUsd), ...(plan.takeTrailPct !== null ? { trailPct: plan.takeTrailPct } : {}) });
  if (plan.legStop !== null) legs.forEach((l, i) => l.side === "sell" && add({ kind: "leg_stop", level: cents(plan.legStop! * l.price), leg: i, ...(plan.trailRestPct === null ? {} : { trailPct: plan.trailRestPct }) }));
  if (plan.legBuyBackAt !== null) {
    const at = plan.legBuyBackAt;
    legs.forEach((l, i) => l.side === "sell" && l.price > at && add({ kind: "leg_take", level: cents(at), leg: i }));
  } else if (plan.legBuyBackShare !== null) {
    const share = plan.legBuyBackShare;
    legs.forEach((l, i) => l.side === "sell" && cents(share * l.price) > 0 && add({ kind: "leg_take", level: cents(share * l.price), leg: i }));
  }
  if (plan.ladder !== null) {
    const levels = plan.ladder;
    levels.forEach((pct, i) => add({ kind: "step", level: pct, closeShare: Number(toDecimal(1 / (levels.length + 1 - i), 6)) }));
  }
  if (plan.lock !== null) add({ kind: "lock", value: cents(plan.lock.atUsd), level: cents(plan.lock.floorUsd) });
  if (plan.exitHourUtc !== null) add({ kind: "time", trigger: "at", level: nextHourUtc(entryMs, plan.exitHourUtc) });
  if (plan.stopUsd !== null) add({ kind: "stop", level: -cents(plan.stopUsd) });
  if (plan.timeStopDte !== null) add({ kind: "time", trigger: "dte", level: plan.timeStopDte });
  return rules;
}

export function simulateTrade(input: SimInput): SimResult {
  const { legs, unitsPerLot, feeRule } = input;
  if (legs.length === 0 || legs.some((l) => !(l.lots >= 1))) throw new Error("A trade to replay has legs, each of at least one lot");
  const open = legs.map((l) => l.lots);
  const rules = rulesOf(legs, input.plan, input.entryMs);
  const events: SimEvent[] = [];
  let realised = 0;
  let fees = feeRule ? legs.reduce((sum, l) => sum + fillFee(l.kind, input.entrySpot * l.lots * unitsPerLot, l.price * l.lots * unitsPerLot, feeRule), 0) : 0;
  let closedMs: number | null = null;
  let reason: CloseReason | null = null;
  let stopped = false;
  let barsSkipped = 0;
  let barsJudged = 0;
  const held = () => open.some((n) => n > 0);

  for (const bar of input.bars) {
    if (bar.ts <= input.entryMs || bar.ts >= input.settleMs) continue;
    if (!held()) break;
    if (legs.some((_, i) => open[i]! > 0 && !(Number(bar.marks[i] ?? NaN) > 0))) {
      barsSkipped += 1;
      continue;
    }
    barsJudged += 1;
    const mark = (i: number) => bar.marks[i]!;
    const pnlNow = () => realised + legs.reduce((sum, l, i) => sum + (open[i]! > 0 ? (mark(i) - l.price) * open[i]! * unitsPerLot * sign(l.side) : 0), 0);
    // the live engine fires one rule a tick and looks again two seconds later: within one bar that is "until nothing fires"
    for (;;) {
      if (!held()) break;
      const pnl = pnlNow();
      const ordered = rules.filter((r) => r.armed).sort((a, b) => RULE_KIND_ORDER[a.kind] - RULE_KIND_ORDER[b.kind] || (a.kind === "step" && b.kind === "step" ? a.level - b.level : 0));
      let fired: Rule | null = null;
      let exit: number[] = legs.map((_, i) => i).filter((i) => open[i]! > 0);
      for (const rule of ordered) {
        let crossed = false;
        const trail = (current: number, floorOf: (peak: number) => number) => {
          rule.peak = rule.peak === null ? seenOf(current) : Math.max(rule.peak, seenOf(current));
          return current <= floorOf(rule.peak);
        };
        if (rule.kind === "stop") crossed = pnl <= rule.level;
        else if (rule.kind === "target") {
          if (rule.trailPct === undefined) crossed = pnl >= rule.level;
          else if (rule.peak !== null || pnl >= rule.level) crossed = trail(pnl, (peak) => trailFloorUsd(peak, { trigger: "pct", value: String(rule.trailPct) }));
        } else if (rule.kind === "trail") {
          const gain = pnl - rule.level;
          if (rule.peak !== null || Math.floor(gain * 100 + 1e-6) >= 1) crossed = trail(gain, (peak) => restTrailFloorUsd(peak, { trigger: "pct", value: String(rule.trailPct) }));
        } else if (rule.kind === "lock") {
          if (rule.peak === null) {
            if (pnl >= rule.value!) rule.peak = seenOf(pnl);
          } else crossed = pnl <= rule.level;
        } else if (rule.kind === "step") {
          const up = openProfitPct(exit.map((i) => ({ side: legs[i]!.side, lots: open[i]!, entry: legs[i]!.price, mark: mark(i) })), unitsPerLot);
          if (up === null) continue;
          crossed = up >= rule.level;
          // nothing to close (every leg is down to its last lot): the step is void, never "taken"
          if (crossed && exit.every((i) => stepLots(open[i]!, rule.closeShare!) < 1)) {
            rule.armed = false;
            continue;
          }
        } else if (rule.kind === "leg_stop" || rule.kind === "leg_take") {
          const i = rule.leg!;
          if (!(open[i]! > 0)) {
            rule.armed = false; // the leg it watched is closed
            continue;
          }
          // (a buy-back fires downwards; a mark of nothing never reaches here: such a bar is not judged at all)
          crossed = rule.kind === "leg_take" ? mark(i) <= rule.level : mark(i) >= rule.level;
          if (crossed) exit = [i];
        } else if (rule.trigger === "at") crossed = bar.ts >= rule.level;
        else crossed = Math.max(0, (input.settleMs - bar.ts) / 86_400_000) <= rule.level;
        if (crossed) {
          fired = rule;
          break;
        }
      }
      if (!fired) break;
      fired.armed = false;
      const closed: SimEvent["closed"] = [];
      // short legs first, as the live exit goes
      for (const i of [...exit.filter((x) => legs[x]!.side === "sell"), ...exit.filter((x) => legs[x]!.side === "buy")]) {
        const l = legs[i]!;
        const qty = fired.kind === "step" ? stepLots(open[i]!, fired.closeShare!) : open[i]!;
        if (qty < 1) continue;
        const price = cents(mark(i));
        realised += cents((price - l.price) * qty * unitsPerLot * sign(l.side));
        if (feeRule) fees += fillFee(l.kind, (bar.spot ?? input.entrySpot) * qty * unitsPerLot, price * qty * unitsPerLot, feeRule);
        open[i] = open[i]! - qty;
        closed.push({ leg: i, lots: qty, price });
      }
      if (fired.kind === "leg_stop") stopped = true;
      const whole = fired.kind !== "step" && fired.kind !== "leg_stop" && fired.kind !== "leg_take";
      if (whole || !held()) {
        for (const r of rules) r.armed = false;
        closedMs = bar.ts;
        // a buy-back that closes the last leg of a trade whose other option was stopped: the trade ended as stopped
        reason = fired.kind === "leg_take" && stopped ? "stopped" : CLOSE_REASON_OF_KIND[fired.kind];
      } else if (fired.kind === "leg_stop" && fired.trailPct !== undefined && !rules.some((r) => r.armed && r.kind === "trail")) {
        // the rest is trailed from the realised total of this moment (ADR-104)
        rules.push({ kind: "trail", level: realised, trailPct: fired.trailPct, peak: null, armed: true });
      }
      events.push({ ts: bar.ts, kind: fired.kind, closed, pnl: held() ? pnlNow() : realised });
    }
  }

  if (held()) {
    const closed: SimEvent["closed"] = [];
    legs.forEach((l, i) => {
      const qty = open[i]!;
      if (qty < 1) return;
      const value = cents(Math.max(0, l.kind === "call" ? input.settleSpot - l.strike : l.strike - input.settleSpot));
      realised += cents((value - l.price) * qty * unitsPerLot * sign(l.side));
      if (feeRule) fees += settlementFee(l.kind, input.settleSpot * qty * unitsPerLot, value * qty * unitsPerLot, feeRule);
      open[i] = 0;
      closed.push({ leg: i, lots: qty, price: value });
    });
    closedMs = input.settleMs;
    reason = "expired";
    events.push({ ts: input.settleMs, kind: "settled", closed, pnl: realised });
  }
  return { gross: realised, fees, net: realised - fees, closedMs: closedMs!, reason: reason!, events, barsSkipped, barsJudged };
}

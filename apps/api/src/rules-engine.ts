// Exit rules run by HapieCoin (ADR-059 §2.3; HC-TR-166, HC-TR-170; roadmap A4). Every `intervalMs` the leader replica
// reads the venue's public marks and spot for the underlyings of the armed rules, values each strategy's P&L from them
// (the same arithmetic the Live tab and the server-side alerts use) and judges each rule: a stop or target on the
// P&L, a leg stop on one leg's mark, a spot level on the underlying, a time exit at an instant, at d days to the
// nearest expiry, or n minutes before the nearest expiry settles (ADR-097: a calendar closes whole). A crossed rule exits every open filled leg of the strategy (a leg stop with leg scope: that leg
// alone): short legs first, market at the mark of that tick, through the exit path a click uses, its own lots only.
// A target with a trail (ADR-103; HC-TR-210) does not exit at its level: from that tick the rule keeps the best P&L
// seen on its own row and exits when the P&L falls back to that best less the give-back.
// A leg stop that exits its leg alone can carry a give-back (ADR-104; HC-TR-212): once that leg is out the engine arms
// one rule of kind trail, whose level is the realised total of that moment. Where the legs still open stand is the
// P&L less that level; the trail keeps the best standing and exits every open leg on a fall from it.
// Paper strategies fire too, with no orders. A fired rule never re-arms; the row guard (armed → fired) makes a fire
// happen once across ticks and replicas. An exit the venue accepted but has not filled, or one that may not have
// reached it, is never re-sent: the leg is left for the order sync and named on the rule.
// Never runs under NODE_ENV=test unless a test calls it.
import { CLOSE_REASON_OF_KIND, RULE_KIND_LABELS, RULE_KIND_ORDER, type Underlying, nearestSettlement, openProfitPct, restTrailFloorUsd, settlementMsOf, stepLots, toDecimal, trailFloorUsd } from "@hapiecoin/schema";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import { strategies, strategyAdjustments, strategyLegs, strategyOrders, strategyRules, users } from "./db/schema.js";
import { type DeltaCredentials } from "@hapiecoin/venues";
import { lotSizeFor, openCredential, tradingBlockedReason, tryExit } from "./routes/live-exec.js";
import { type AppDeps, errorMessage, newId } from "./routes/shared.js";
import { addDecimal, closeLegRow, disarmRules, freshTotal } from "./routes/strategies.js";

export interface RulesTick {
  /** Mark per venue symbol for every listed option and perpetual of the underlying, at this tick. */
  marks: Map<string, number>;
  /** The underlying's spot at this tick; null when the venue gave none (a spot rule waits for the next tick). */
  spot: number | null;
}
export interface RulesTickSource {
  /** The marks and spot of `asset` on `venue` (ADR-070); null when this API reads no market data for that venue (its rules wait). */
  tick(asset: Underlying, venue: string): Promise<RulesTick | null>;
}

/**
 * ADR-158 (HC-TR-316): whether a bought leg covers a sold one, so that it must not be sold while the sold one is still
 * held. An option covers a sold option of its own kind (a call a call, a put a put). Where either is a future the
 * answer is yes: which side a future covers depends on the rest of the trade, and keeping a leg is the safe mistake.
 */
export function coversSold(boughtKind: string, soldKind: string): boolean {
  return boughtKind === soldKind || boughtKind === "future" || soldKind === "future";
}

export interface RulesReport {
  /** Armed rules whose strategy could be valued this tick. */
  checked: number;
  /** Rule ids that fired. */
  fired: string[];
  /** Rules left for the next tick: a leg without a mark, no marks for the underlying, no spot for a spot rule, an unfilled watched leg, an unreadable wallet, trading paused. */
  skipped: number;
}

export interface RulesOptions {
  /** Attempts per leg on a refused live exit the venue calls retryable, before the leg is reported still open. */
  attempts?: number;
  /** Pause between attempts, ms (tests pass 0). */
  backoffMs?: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
const sign = (side: "buy" | "sell") => (side === "buy" ? 1 : -1);

/** One pass; failures are logged per strategy and never thrown. */
export async function evaluateRules(deps: AppDeps, source: RulesTickSource, now: () => number = Date.now, opts: RulesOptions = {}): Promise<RulesReport> {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 750;
  const rows = await deps.db
    .select({ rule: strategyRules, strategy: strategies })
    .from(strategyRules)
    .innerJoin(strategies, eq(strategyRules.strategyId, strategies.id))
    .where(and(eq(strategyRules.state, "armed"), inArray(strategies.status, ["paper", "live"])));
  type Row = (typeof rows)[number];
  const byStrategy = new Map<string, { strategy: Row["strategy"]; rules: Row["rule"][] }>();
  for (const { rule, strategy } of rows) {
    const e = byStrategy.get(strategy.id) ?? { strategy, rules: [] };
    e.rules.push(rule);
    byStrategy.set(strategy.id, e);
  }
  const out: RulesReport = { checked: 0, fired: [], skipped: 0 };
  // one ticker read per underlying per venue per pass; a read that failed is remembered so the outage is logged once, not per strategy
  const tickCache = new Map<string, RulesTick | null>();
  const tickFor = async (asset: Underlying, venue: string): Promise<RulesTick | null> => {
    const key = `${venue}:${asset}`;
    if (tickCache.has(key)) return tickCache.get(key) ?? null;
    let m: RulesTick | null = null;
    try {
      m = await source.tick(asset, venue);
      if (m === null) deps.logger.debug({ asset, venue }, "rules: this API reads no market data for the venue; its rules wait (API_VENUES)");
    } catch (e) {
      deps.logger.warn({ asset, venue, err: errorMessage(e) }, "rules: marks unavailable this tick");
    }
    tickCache.set(key, m);
    return m;
  };
  for (const { strategy, rules } of byStrategy.values()) {
    try {
      const user = { id: strategy.userId, email: "", name: "", role: "user" as const };
      // only legs the exchange (or the paper book) actually holds count: a never-filled entry is not a position
      // (in the trade's own order, so that the orders of an exit go out in one known order)
      const openLegs = await deps.db.select().from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).orderBy(asc(strategyLegs.position));
      const legs = openLegs.filter((l) => l.entryPrice !== null);
      const tick = legs.length ? await tickFor(strategy.asset, strategy.venue) : null;
      if (legs.length === 0 || tick === null) {
        out.skipped += rules.length;
        continue;
      }
      const marks = tick.marks;
      const lotSize = Number(await lotSizeFor(deps, user, strategy.asset, strategy.venue));
      // the realised total is read again right after the legs: the row from the pass's first query can be seconds old
      // (another strategy's exit ran in between), and a leg closed since then would be missing from both sides of the sum
      let pnl = Number(await freshTotal(deps, strategy.id, strategy.realizedPnl));
      let missing = false;
      for (const l of legs) {
        const mark = marks.get(l.symbol);
        if (mark === undefined) {
          missing = true;
          break;
        }
        pnl += (mark - Number(l.entryPrice)) * l.lots * lotSize * sign(l.side);
      }
      if (missing) {
        out.skipped += rules.length;
        continue;
      }
      out.checked += rules.length;
      // days to the nearest settlement of the dated legs (options and dated futures); null with only perpetuals open
      const nearest = nearestSettlement(legs, strategy.asset);
      const dte = nearest ? Math.max(0, (nearest.ms - now()) / 86_400_000) : null;
      // the protective kinds are judged before the target: were two ever crossed at once, the protective one wins
      // profit steps among themselves: the lowest level first, so two crossed on one tick go in the order of the ladder
      const ordered = [...rules].sort((a, b) => RULE_KIND_ORDER[a.kind] - RULE_KIND_ORDER[b.kind] || (a.kind === "step" && b.kind === "step" ? Number(a.thresholdUsd) - Number(b.thresholdUsd) : 0));
      for (const rule of ordered) {
        const at = new Date(now());
        const level = Number(rule.thresholdUsd);
        // the rule is void when what it watches is gone: it is disarmed with the reason, never fired
        const moot = async (why: string) => {
          await deps.db.update(strategyRules).set({ state: "disarmed", note: `disarmed: ${why}`, updatedAt: at }).where(and(eq(strategyRules.id, rule.id), eq(strategyRules.state, "armed")));
          out.checked -= 1;
        };
        let crossed = false;
        let detail = "";
        let exitLegs = legs;
        // one step of a trail on `current` (the strategy P&L for a target, the standing of the rest for a trail rule):
        // the best only rises (written when it does, so a restart or another replica resumes from it); crossed on a
        // fall to the exit level under the best
        const trailStep = async (current: number, floorOf: (peak: number) => number) => {
          const best = rule.peakPnl === null ? null : Number(rule.peakPnl);
          // kept in whole cents rounded down, so the stored best is never above the figure that set it, and written
          // only upwards (the row may have been raised by another pass since this one read it)
          const seen = Math.floor(current * 100 + 1e-6) / 100;
          const peak = best === null ? seen : Math.max(best, seen);
          if (best === null || peak > best)
            await deps.db
              .update(strategyRules)
              .set({ peakPnl: toDecimal(peak, 2), updatedAt: at })
              .where(and(eq(strategyRules.id, rule.id), eq(strategyRules.state, "armed"), or(isNull(strategyRules.peakPnl), sql`${strategyRules.peakPnl}::numeric < ${peak}`)));
          const floor = floorOf(peak);
          return { crossed: current <= floor, peak, floor };
        };
        if (rule.kind === "stop") crossed = pnl <= level;
        else if (rule.kind === "target") {
          if (rule.trailTrigger === null) crossed = pnl >= level;
          else if (rule.peakPnl !== null || pnl >= level) {
            // trailing (ADR-103): nothing happens below the level; the tick that reaches it starts the trail and exits
            // nothing; after that the rule fires on a fall to the best less the give-back
            const give = { trigger: rule.trailTrigger, value: rule.trailValue! };
            const step = await trailStep(pnl, (peak) => trailFloorUsd(peak, give));
            crossed = step.crossed;
            detail = `trailed from the best ${toDecimal(step.peak, 2)} USD, exit level ${toDecimal(step.floor, 2)} USD`;
          }
        }
        else if (rule.kind === "trail") {
          // where the rest stands (ADR-104): the level is the realised total when the leg stop fired, so the stopped
          // leg's loss is not in it and a later trim (its result moves into the realised total) does not move it.
          // Money starts at once; a percentage has nothing to take a share of until the rest is a cent in profit, and
          // its give-back is never under REST_TRAIL_MIN_GIVE_USD (a share of a few cents is flicker).
          const gain = pnl - level;
          const giveBack = { trigger: rule.trigger === "pct" ? ("pct" as const) : ("money" as const), value: rule.value };
          if (rule.peakPnl !== null || giveBack.trigger === "money" || Math.floor(gain * 100 + 1e-6) >= 1) {
            const step = await trailStep(gain, (peak) => restTrailFloorUsd(peak, giveBack));
            crossed = step.crossed;
            detail = `the rest stands at ${toDecimal(gain, 2)} USD, best ${toDecimal(step.peak, 2)} USD, exit level ${toDecimal(step.floor, 2)} USD`;
          }
        }
        else if (rule.kind === "lock") {
          // a profit lock (ADR-121): below its level nothing happens; the tick that reaches it arms the floor and exits
          // nothing; from then on the strategy closes when the profit is back at the floor. The floor does not move.
          if (rule.peakPnl === null) {
            if (pnl >= Number(rule.value)) await deps.db.update(strategyRules).set({ peakPnl: toDecimal(Math.floor(pnl * 100 + 1e-6) / 100, 2), updatedAt: at }).where(and(eq(strategyRules.id, rule.id), eq(strategyRules.state, "armed"), isNull(strategyRules.peakPnl)));
          } else {
            crossed = pnl <= level;
            detail = `locked when the profit reached ${rule.value} USD, floor ${rule.thresholdUsd} USD`;
          }
        }
        else if (rule.kind === "step") {
          // a profit step (ADR-120): how far the lots still open are up, as a share of the premium they were opened
          // for. Lots closed by an earlier step, a stop or a click are not in it.
          const up = openProfitPct(legs.map((l) => ({ side: l.side, lots: l.lots, entry: Number(l.entryPrice), mark: marks.get(l.symbol)! })), lotSize);
          if (up === null) {
            out.checked -= 1;
            out.skipped += 1;
            continue;
          }
          crossed = up >= level;
          detail = `the open lots are up ${toDecimal(up, 1)} % of their premium, step at ${rule.value} %`;
          // nothing to close (every leg is down to its last lot): the step is void, never "taken"
          if (crossed && legs.every((l) => stepLots(l.lots, rule.closeShare ?? "0") < 1)) {
            await moot("no leg has a lot to spare");
            continue;
          }
        }
        else if (rule.kind === "leg_stop" || rule.kind === "leg_take") {
          const leg = legs.find((l) => l.id === rule.legId);
          if (!leg) {
            // still open but not yet filled: wait; closed by a click, the settler or another rule: void
            const [pending] = await deps.db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.id, rule.legId ?? ""), eq(strategyLegs.status, "open"))).limit(1);
            if (pending) {
              out.checked -= 1;
              out.skipped += 1;
            } else await moot("the leg it watched is closed");
            continue;
          }
          const mark = marks.get(leg.symbol)!;
          // a short leg is stopped when its mark rises to the level, a long one when it falls to it
          // a buy-back fires downwards, so a mark of nothing (a venue's placeholder for "no price") must never read
          // as "it has fallen to the level": no usable mark, no judgement on this tick
          if (rule.kind === "leg_take" && !(mark > 0)) {
            out.checked -= 1;
            out.skipped += 1;
            continue;
          }
          // a buy-back (ADR-123) is the other way round: its sold option has fallen to a price where little is left to earn
          crossed = rule.kind === "leg_take" ? mark <= level : leg.side === "sell" ? mark >= level : mark <= level;
          detail = `${leg.symbol} at ${toDecimal(mark, 2)}, entry ${leg.entryPrice ?? "?"}`;
          // a buy-back exits its own leg whatever the row's scope says
          if (rule.scope === "leg" || rule.kind === "leg_take") exitLegs = [leg];
        } else if (rule.kind === "spot") {
          if (tick.spot === null) {
            out.checked -= 1;
            out.skipped += 1;
            continue;
          }
          crossed = rule.trigger === "above" ? tick.spot >= level : tick.spot <= level;
          detail = `spot ${toDecimal(tick.spot, 2)}`;
        } else if (rule.trigger === "at") {
          crossed = now() >= level;
          detail = `at ${at.toISOString()}`;
        } else if (rule.trigger === "settle") {
          // the instant was fixed when the rule was armed, from the nearest dated leg then held. Before that instant the
          // rule is void once that expiry is no longer held (rolled or closed by hand): it would exit the new position
          // at a moment that means nothing to it. From the instant on it fires, even late after an outage: the settler
          // may have booked the near leg by then and the far leg is what is left to close, the wanted outcome.
          const lead = Number(rule.value) * 60_000;
          const held = legs.some((l) => l.expiry !== "PERP" && settlementMsOf(l.expiry, strategy.asset) === level + lead);
          if (!held && now() < level) {
            await moot("the expiry it counted to is no longer held; arm it again");
            continue;
          }
          crossed = now() >= level;
          detail = `${rule.value} min before the nearest settlement, at ${new Date(level).toISOString()}${now() > level + 60_000 ? ", late" : ""}`;
        } else {
          if (dte === null) {
            await moot("no dated leg is open");
            continue;
          }
          crossed = dte <= level;
          detail = `${toDecimal(dte, 1)} days to expiry`;
        }
        if (!crossed) {
          if (rule.note?.startsWith("not sent:")) await deps.db.update(strategyRules).set({ note: null, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          continue;
        }
        // the rule stays armed and says why nothing was sent (the kill switch, a credential that cannot be opened);
        // written once, not every tick, and cleared once the way is free again
        const hold = async (why: string) => {
          const note = `not sent: ${why}`;
          if (rule.note !== note) await deps.db.update(strategyRules).set({ note, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          out.skipped += 1;
        };
        let creds: DeltaCredentials | null = null;
        // a step closes part of a leg: on paper only for now (the route refuses it on a live trade; one that went live
        // with steps armed waits here and says so)
        if (rule.kind === "step" && strategy.status === "live") {
          await hold("profit steps are on paper trades only for now");
          continue;
        }
        // a buy-back at a mark of a few dollars is not a price the exchange will fill at: on paper only for now (ADR-123)
        if (rule.kind === "leg_take" && strategy.status === "live") {
          await hold("a buy-back of a cheap leg is on paper trades only for now");
          continue;
        }
        if (strategy.status === "live") {
          const blocked = await tradingBlockedReason(deps, user);
          if (blocked) {
            await hold(blocked);
            continue;
          }
          // everything a fire needs is in hand before the claim
          try {
            creds = await openCredential(deps, user, strategy.brokerId ?? "", undefined, strategy.accountId);
          } catch (e) {
            await hold(errorMessage(e));
            continue;
          }
        }
        if (rule.note?.startsWith("not sent:")) await deps.db.update(strategyRules).set({ note: null, updatedAt: at }).where(eq(strategyRules.id, rule.id));
        // the guard: one fire per rule across ticks and replicas
        const [claimed] = await deps.db
          .update(strategyRules)
          .set({ state: "fired", firedAt: at, firedPnl: toDecimal(pnl, 2), note: null, updatedAt: at })
          .where(and(eq(strategyRules.id, rule.id), eq(strategyRules.state, "armed")))
          .returning({ id: strategyRules.id });
        if (!claimed) continue;
        const label = RULE_KIND_LABELS[rule.kind];
        try {
          const reason = CLOSE_REASON_OF_KIND[rule.kind];
          const batchId = `rule:${rule.id}`;
          // short legs first: buying them back frees margin and never leaves a naked side
          const order = [...exitLegs].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
          let batchPnl = "0";
          const fills: { symbol: string; fill: string }[] = [];
          let closedLots = 0;
          const failed: { symbol: string; error: string }[] = [];
          const unconfirmed: { symbol: string; what: string }[] = [];
          // ADR-158 (HC-TR-316): the sold legs whose exit did not go through on the exchange, and the bought legs kept
          // because of them. A bought leg is what limits the loss of a sold one: it is not sold while that one is open.
          const soldOpen: { kind: string; waiting: boolean }[] = [];
          const kept: string[] = [];
          // a sold leg this exit does not reach because its ENTRY order is still with the exchange (it has no entry
          // price yet, so it is not among the legs valued): it may be held there, and its cover stays too
          if (creds && exitLegs === legs) {
            for (const l of openLegs.filter((x) => x.entryPrice === null && x.side === "sell")) {
              const [entering] = await deps.db.select({ id: strategyOrders.id }).from(strategyOrders).where(and(eq(strategyOrders.legId, l.id), eq(strategyOrders.purpose, "entry"), eq(strategyOrders.state, "pending"))).limit(1);
              if (entering) {
                soldOpen.push({ kind: l.kind, waiting: true });
                unconfirmed.push({ symbol: l.symbol, what: "its entry order is still with the exchange · sync" });
              }
            }
          }
          for (const seen of order) {
            // the leg is re-read right before the order: a click or the settler may have closed it since the pass began
            const [leg] = await deps.db.select().from(strategyLegs).where(and(eq(strategyLegs.id, seen.id), eq(strategyLegs.status, "open"))).limit(1);
            if (!leg) continue;
            // a step takes its share of what the leg holds now, in whole lots; a leg down to one lot keeps it
            const qty = rule.kind === "step" ? stepLots(leg.lots, rule.closeShare ?? "0") : leg.lots;
            if (qty < 1) continue;
            const mark = marks.get(leg.symbol)!;
            let fill: string | null = null;
            if (creds) {
              // (the sold legs went first, so by the first bought leg every sold one has its answer)
              if (leg.side === "buy" && soldOpen.some((s) => coversSold(leg.kind, s.kind))) {
                kept.push(leg.symbol);
                continue;
              }
              // an exit for this leg that rested (from an earlier rule, or a click) is still the venue's to fill: never a second one
              const [resting] = await deps.db.select({ id: strategyOrders.id }).from(strategyOrders).where(and(eq(strategyOrders.legId, leg.id), eq(strategyOrders.purpose, "exit"), eq(strategyOrders.state, "pending"))).limit(1);
              if (resting) {
                unconfirmed.push({ symbol: leg.symbol, what: "an earlier exit is still filling · sync" });
                if (leg.side === "sell") soldOpen.push({ kind: leg.kind, waiting: true });
                continue;
              }
              let lastError = "";
              for (let i = 1; i <= attempts && fill === null; i += 1) {
                let outcome;
                try {
                  outcome = await tryExit(deps, creds, user, strategy, leg, qty, batchId);
                } catch (e) {
                  // a product lookup or sizing failure before any order: this leg is reported, the rest of the batch goes on
                  lastError = errorMessage(e);
                  break;
                }
                if (outcome.status === "filled") {
                  fill = outcome.fill;
                } else if (outcome.status === "pending" || outcome.status === "unknown") {
                  // the venue may hold this order: never send another for the same leg
                  unconfirmed.push({ symbol: leg.symbol, what: outcome.status === "pending" ? "exit still filling" : `may have reached the exchange: ${outcome.message} · sync` });
                  lastError = "";
                  break;
                } else {
                  lastError = outcome.message;
                  if (!outcome.retryable) break;
                  if (i < attempts) await sleep(backoffMs);
                }
              }
              if (fill === null) {
                if (lastError) failed.push({ symbol: leg.symbol, error: lastError });
                // refused, failed before the order, or with the exchange and not confirmed: this sold leg is still held
                // (no error text: the order is with the exchange and waits for the sync)
                if (leg.side === "sell") soldOpen.push({ kind: leg.kind, waiting: !lastError });
                continue;
              }
            } else {
              fill = toDecimal(mark, 2);
            }
            try {
              batchPnl = addDecimal(batchPnl, await closeLegRow(deps, strategy, leg, fill, qty < leg.lots ? qty : undefined, String(lotSize), at, reason));
              fills.push({ symbol: leg.symbol, fill });
              closedLots += qty;
            } catch (e) {
              // closed meanwhile by the trader or the settler: the exit went out but its book-keeping is theirs
              failed.push({ symbol: leg.symbol, error: errorMessage(e) });
            }
          }
          const outcome = failed.length === 0 && unconfirmed.length === 0 && kept.length === 0 ? ("closed" as const) : ("partial" as const);
          const parts = [rule.kind === "step" ? `${closedLots} ${closedLots === 1 ? "lot" : "lots"} closed on ${fills.length} ${fills.length === 1 ? "leg" : "legs"}, the rest kept` : `${fills.length} ${fills.length === 1 ? "leg" : "legs"} exited`];
          if (unconfirmed.length) parts.push(`${unconfirmed.length} still filling on the exchange: ${unconfirmed.map((u) => `${u.symbol} (${u.what})`).join("; ")}`);
          if (failed.length) parts.push(`${failed.length} still open: ${failed.map((f) => `${f.symbol} (${f.error})`).join("; ")}`);
          if (kept.length) {
            const these = kept.length === 1 ? "this one" : "these";
            // an order still with the exchange cannot be closed over: the sync comes first
            const next = soldOpen.some((s) => s.waiting) ? `press Sync on the trade; once the sold leg is closed, close ${these}` : `close the sold leg first, then ${these}`;
            parts.push(`${kept.length} bought ${kept.length === 1 ? "leg" : "legs"} held back (not sold) because a sold leg ${kept.length === 1 ? "it covers" : "they cover"} is still open: ${kept.join(", ")} · ${next}`);
          }
          const realized = addDecimal(await freshTotal(deps, strategy.id, strategy.realizedPnl), batchPnl);
          const left = await deps.db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).limit(1);
          const archive = left.length === 0;
          // a buy-back that closes the last leg of a trade whose other option was stopped: the trade ended as stopped,
          // not as a target hit (the tallies by reason read the trade's reason)
          const [wasStopped] = archive && rule.kind === "leg_take" ? await deps.db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.closeReason, "stopped"))).limit(1) : [];
          const archiveReason = wasStopped ? ("stopped" as const) : reason;
          // a leg stop set to trail the rest (ADR-104): its leg is out and booked here, legs stay open, so the trail is
          // armed from the realised total of this moment. Not when the exit is unconfirmed or this fire booked nothing
          // (the leg may still be held, or was closed by a click whose result is not in the total yet: the rest is not
          // yet "the rest"), and never a second trail beside one already running.
          let armTrail = false;
          if (rule.kind === "leg_stop" && rule.scope === "leg" && rule.trailTrigger !== null && !archive) {
            if (outcome !== "closed" || fills.length === 0) parts.push("the trail on the rest did not start: this leg's exit is not confirmed");
            else {
              const [running] = await deps.db.select({ id: strategyRules.id }).from(strategyRules).where(and(eq(strategyRules.strategyId, strategy.id), eq(strategyRules.kind, "trail"), eq(strategyRules.state, "armed"))).limit(1);
              if (running) parts.push("the trail on the rest is already running");
              else {
                armTrail = true;
                parts.push(`now trailing the rest (give-back ${rule.trailValue!}${rule.trailTrigger === "pct" ? " %" : " USD"})`);
              }
            }
          }
          const note = `${label} fired at P&L ${toDecimal(pnl, 2)} USD${detail ? ` (${detail})` : ""}: ${parts.join(", ")}`;
          await deps.db.update(strategyRules).set({ outcome, note, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          await deps.db.insert(strategyAdjustments).values({ id: newId("adj"), strategyId: strategy.id, batchId, reason: note, added: 0, trimmed: rule.kind === "step" ? fills.length : 0, closed: rule.kind === "step" ? 0 : fills.length, realizedPnl: batchPnl, createdAt: at });
          // the other rules of the strategy are moot once the whole strategy exits; after a one-leg exit they keep watching what is left
          if ((rule.scope === "strategy" && rule.kind !== "step") || archive) await disarmRules(deps, strategy.id, `disarmed: the ${label.toLowerCase()} fired`, at);
          await deps.db
            .update(strategies)
            .set({ realizedPnl: realized, updatedAt: at, ...(archive ? { status: "archived" as const, closedAt: at, closeReason: archiveReason } : {}) })
            .where(eq(strategies.id, strategy.id));
          // armed last, once the total it starts from is stored: a failure before this line leaves no trail, never one
          // whose level is ahead of the total
          if (armTrail) await deps.db.insert(strategyRules).values({ id: newId("rule"), strategyId: strategy.id, kind: "trail", trigger: rule.trailTrigger!, value: rule.trailValue!, thresholdUsd: realized, scope: "strategy", channels: rule.channels, state: "armed", createdAt: at, updatedAt: at });
          await writeAudit(deps.db, {
            actorId: null,
            action: "strategy.rule_fire",
            target: `strategy:${strategy.id}`,
            before: { rule: rule.id, kind: rule.kind, trigger: rule.trigger, level: rule.thresholdUsd, legId: rule.legId, scope: rule.scope, detail, pnl: toDecimal(pnl, 2), spot: tick.spot, marks: legs.map((l) => ({ symbol: l.symbol, mark: marks.get(l.symbol), entry: l.entryPrice })) },
            after: { outcome, fills, unconfirmed, failed, kept, realizedPnl: realized, archived: archive },
          });
          await notify(deps, strategy.userId, rule.channels, `${label} fired · ${strategy.name}`, `${note}\n\n${deps.config.webUrl}/desk`);
          out.fired.push(rule.id);
          deps.logger.info({ strategyId: strategy.id, rule: rule.id, kind: rule.kind, pnl: toDecimal(pnl, 2), outcome, failed: failed.length, unconfirmed: unconfirmed.length, kept: kept.length }, "rule fired");
        } catch (e) {
          // claimed, then something broke before the bookkeeping finished: say so on the rule, never leave it blank
          const message = errorMessage(e);
          await deps.db.update(strategyRules).set({ outcome: "partial", note: `${label} fired at P&L ${toDecimal(pnl, 2)} USD but the exit did not complete: ${message} · check the legs and Reconcile`, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          deps.logger.error({ strategyId: strategy.id, rule: rule.id, err: message }, "rule fire failed after the claim");
          out.fired.push(rule.id);
        }
        break; // one fire per strategy per tick
      }
    } catch (e) {
      out.skipped += rules.length;
      deps.logger.warn({ strategyId: strategy.id, err: errorMessage(e) }, "rules: strategy skipped");
    }
  }
  return out;
}

/** Email and Telegram like a fired alert (ADR-057); push is the card itself. Failures are logged, never thrown. */
async function notify(deps: AppDeps, userId: string, channels: string[], subject: string, text: string): Promise<void> {
  const wantsMail = channels.includes("email");
  const wantsTelegram = channels.includes("telegram");
  if (!wantsMail && !wantsTelegram) return;
  const [user] = await deps.db.select({ email: users.email, telegramChatId: users.telegramChatId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  if (wantsMail) {
    try {
      await deps.mailer.sendAlert({ email: user.email, subject: `HapieCoin · ${subject}`, text });
    } catch (e) {
      deps.logger.warn({ userId, reason: errorMessage(e) }, "rule mail failed");
    }
  }
  if (wantsTelegram && user.telegramChatId && deps.telegram) {
    try {
      await deps.telegram.sendMessage(user.telegramChatId, `HapieCoin · ${subject}\n${text}`);
    } catch (e) {
      deps.logger.warn({ userId, reason: errorMessage(e) }, "rule telegram failed");
    }
  }
}

/** Start the periodic pass; returns the stop function. Overlapping passes are skipped. */
export function startRulesEngine(deps: AppDeps, source: RulesTickSource, intervalMs = 2_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await evaluateRules(deps, source);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

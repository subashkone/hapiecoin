// Exit rules run by HapieCoin (ADR-059 §2.3; HC-TR-166, HC-TR-170; roadmap A4). Every `intervalMs` the leader replica
// reads the venue's public marks and spot for the underlyings of the armed rules, values each strategy's P&L from them
// (the same arithmetic the Live tab and the server-side alerts use) and judges each rule: a stop or target on the
// P&L, a leg stop on one leg's mark, a spot level on the underlying, a time exit at an instant or at d days to the
// nearest expiry. A crossed rule exits every open filled leg of the strategy (a leg stop with leg scope: that leg
// alone): short legs first, market at the mark of that tick, through the exit path a click uses, its own lots only.
// Paper strategies fire too, with no orders. A fired rule never re-arms; the row guard (armed → fired) makes a fire
// happen once across ticks and replicas. An exit the venue accepted but has not filled, or one that may not have
// reached it, is never re-sent: the leg is left for the order sync and named on the rule.
// Never runs under NODE_ENV=test unless a test calls it.
import { CLOSE_REASON_OF_KIND, RULE_KIND_LABELS, RULE_KIND_ORDER, type Underlying, nearestSettlement, toDecimal } from "@hapiecoin/schema";
import { and, eq, inArray } from "drizzle-orm";
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
  tick(asset: Underlying): Promise<RulesTick>;
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
  // one ticker read per underlying per pass; a read that failed is remembered so the outage is logged once, not per strategy
  const tickCache = new Map<string, RulesTick | null>();
  const tickFor = async (asset: Underlying): Promise<RulesTick | null> => {
    if (tickCache.has(asset)) return tickCache.get(asset) ?? null;
    let m: RulesTick | null = null;
    try {
      m = await source.tick(asset);
    } catch (e) {
      deps.logger.warn({ asset, err: errorMessage(e) }, "rules: marks unavailable this tick");
    }
    tickCache.set(asset, m);
    return m;
  };
  for (const { strategy, rules } of byStrategy.values()) {
    try {
      const user = { id: strategy.userId, email: "", name: "", role: "user" as const };
      // only legs the exchange (or the paper book) actually holds count: a never-filled entry is not a position
      const legs = (await deps.db.select().from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open")))).filter((l) => l.entryPrice !== null);
      const tick = legs.length ? await tickFor(strategy.asset) : null;
      if (legs.length === 0 || tick === null) {
        out.skipped += rules.length;
        continue;
      }
      const marks = tick.marks;
      const lotSize = Number(await lotSizeFor(deps, user, strategy.asset));
      let pnl = Number(strategy.realizedPnl);
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
      const ordered = [...rules].sort((a, b) => RULE_KIND_ORDER[a.kind] - RULE_KIND_ORDER[b.kind]);
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
        if (rule.kind === "stop") crossed = pnl <= level;
        else if (rule.kind === "target") crossed = pnl >= level;
        else if (rule.kind === "leg_stop") {
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
          crossed = leg.side === "sell" ? mark >= level : mark <= level;
          detail = `${leg.symbol} at ${toDecimal(mark, 2)}, entry ${leg.entryPrice ?? "?"}`;
          if (rule.scope === "leg") exitLegs = [leg];
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
          const failed: { symbol: string; error: string }[] = [];
          const unconfirmed: { symbol: string; what: string }[] = [];
          for (const seen of order) {
            // the leg is re-read right before the order: a click or the settler may have closed it since the pass began
            const [leg] = await deps.db.select().from(strategyLegs).where(and(eq(strategyLegs.id, seen.id), eq(strategyLegs.status, "open"))).limit(1);
            if (!leg) continue;
            const mark = marks.get(leg.symbol)!;
            let fill: string | null = null;
            if (creds) {
              // an exit for this leg that rested (from an earlier rule, or a click) is still the venue's to fill: never a second one
              const [resting] = await deps.db.select({ id: strategyOrders.id }).from(strategyOrders).where(and(eq(strategyOrders.legId, leg.id), eq(strategyOrders.purpose, "exit"), eq(strategyOrders.state, "pending"))).limit(1);
              if (resting) {
                unconfirmed.push({ symbol: leg.symbol, what: "an earlier exit is still filling · sync" });
                continue;
              }
              let lastError = "";
              for (let i = 1; i <= attempts && fill === null; i += 1) {
                let outcome;
                try {
                  outcome = await tryExit(deps, creds, user, strategy, leg, leg.lots, batchId);
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
                continue;
              }
            } else {
              fill = toDecimal(mark, 2);
            }
            try {
              batchPnl = addDecimal(batchPnl, await closeLegRow(deps, strategy, leg, fill, undefined, String(lotSize), at, reason));
              fills.push({ symbol: leg.symbol, fill });
            } catch (e) {
              // closed meanwhile by the trader or the settler: the exit went out but its book-keeping is theirs
              failed.push({ symbol: leg.symbol, error: errorMessage(e) });
            }
          }
          const outcome = failed.length === 0 && unconfirmed.length === 0 ? ("closed" as const) : ("partial" as const);
          const parts = [`${fills.length} ${fills.length === 1 ? "leg" : "legs"} exited`];
          if (unconfirmed.length) parts.push(`${unconfirmed.length} still filling on the exchange: ${unconfirmed.map((u) => `${u.symbol} (${u.what})`).join("; ")}`);
          if (failed.length) parts.push(`${failed.length} still open: ${failed.map((f) => `${f.symbol} (${f.error})`).join("; ")}`);
          const note = `${label} fired at P&L ${toDecimal(pnl, 2)} USD${detail ? ` (${detail})` : ""}: ${parts.join(", ")}`;
          await deps.db.update(strategyRules).set({ outcome, note, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          await deps.db.insert(strategyAdjustments).values({ id: newId("adj"), strategyId: strategy.id, batchId, reason: note, added: 0, trimmed: 0, closed: fills.length, realizedPnl: batchPnl, createdAt: at });
          const realized = addDecimal(await freshTotal(deps, strategy.id, strategy.realizedPnl), batchPnl);
          const left = await deps.db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).limit(1);
          const archive = left.length === 0;
          // the other rules of the strategy are moot once the whole strategy exits; after a one-leg exit they keep watching what is left
          if (rule.scope === "strategy" || archive) await disarmRules(deps, strategy.id, `disarmed: the ${label.toLowerCase()} fired`, at);
          await deps.db
            .update(strategies)
            .set({ realizedPnl: realized, updatedAt: at, ...(archive ? { status: "archived" as const, closedAt: at, closeReason: reason } : {}) })
            .where(eq(strategies.id, strategy.id));
          await writeAudit(deps.db, {
            actorId: null,
            action: "strategy.rule_fire",
            target: `strategy:${strategy.id}`,
            before: { rule: rule.id, kind: rule.kind, trigger: rule.trigger, level: rule.thresholdUsd, legId: rule.legId, scope: rule.scope, pnl: toDecimal(pnl, 2), spot: tick.spot, marks: legs.map((l) => ({ symbol: l.symbol, mark: marks.get(l.symbol), entry: l.entryPrice })) },
            after: { outcome, fills, unconfirmed, failed, realizedPnl: realized, archived: archive },
          });
          await notify(deps, strategy.userId, rule.channels, `${label} fired · ${strategy.name}`, `${note}\n\n${deps.config.webUrl}/analyse`);
          out.fired.push(rule.id);
          deps.logger.info({ strategyId: strategy.id, rule: rule.id, kind: rule.kind, pnl: toDecimal(pnl, 2), outcome, failed: failed.length, unconfirmed: unconfirmed.length }, "rule fired");
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

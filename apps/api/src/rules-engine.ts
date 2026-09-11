// Stop and target rules run by HapieCoin (ADR-059 §2.3; HC-TR-166; roadmap A4). Every `intervalMs` the leader replica
// reads the venue's public marks for the underlyings of the armed rules, values each strategy's P&L from them (the
// same arithmetic the Live tab and the server-side alerts use) and, when a rule's level is crossed, exits every open
// filled leg of that strategy: short legs first, market at the mark of that tick, through the exit path a click uses,
// its own lots only. Paper strategies fire too, with no orders. A fired rule never re-arms; the row guard
// (armed → fired) makes a fire happen once across ticks and replicas. An exit the venue accepted but has not filled,
// or one that may not have reached it, is never re-sent: the leg is left for the order sync and named on the rule.
// Never runs under NODE_ENV=test unless a test calls it.
import { RULE_KIND_LABELS, type Underlying, toDecimal } from "@hapiecoin/schema";
import { and, eq, inArray } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import { strategies, strategyAdjustments, strategyLegs, strategyRules, users } from "./db/schema.js";
import { type DeltaCredentials } from "@hapiecoin/venues";
import { lotSizeFor, openCredential, tradingBlockedReason, tryExit } from "./routes/live-exec.js";
import { type AppDeps, errorMessage, newId } from "./routes/shared.js";
import { addDecimal, closeLegRow, disarmRules, freshTotal } from "./routes/strategies.js";

export interface RulesTickSource {
  /** Mark per venue symbol for every listed option and perpetual of the underlying, at this tick. */
  marks(asset: Underlying): Promise<Map<string, number>>;
}

export interface RulesReport {
  /** Armed rules whose strategy could be valued this tick. */
  checked: number;
  /** Rule ids that fired. */
  fired: string[];
  /** Rules left for the next tick: a leg without a mark, no marks for the underlying, an unreadable wallet, trading paused. */
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
  const marksCache = new Map<string, Map<string, number> | null>();
  const marksFor = async (asset: Underlying): Promise<Map<string, number> | null> => {
    if (marksCache.has(asset)) return marksCache.get(asset) ?? null;
    let m: Map<string, number> | null = null;
    try {
      m = await source.marks(asset);
    } catch (e) {
      deps.logger.warn({ asset, err: errorMessage(e) }, "rules: marks unavailable this tick");
    }
    marksCache.set(asset, m);
    return m;
  };
  for (const { strategy, rules } of byStrategy.values()) {
    try {
      const user = { id: strategy.userId, email: "", name: "", role: "user" as const };
      // only legs the exchange (or the paper book) actually holds count: a never-filled entry is not a position
      const legs = (await deps.db.select().from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open")))).filter((l) => l.entryPrice !== null);
      const marks = legs.length ? await marksFor(strategy.asset) : null;
      if (legs.length === 0 || marks === null) {
        out.skipped += rules.length;
        continue;
      }
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
      // a stop is checked before a target: were both ever crossed at once, the protective one wins
      const ordered = [...rules].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "stop" ? -1 : 1));
      for (const rule of ordered) {
        const threshold = Number(rule.thresholdUsd);
        const crossed = rule.kind === "stop" ? pnl <= threshold : pnl >= threshold;
        if (!crossed) {
          if (rule.note?.startsWith("not sent:")) await deps.db.update(strategyRules).set({ note: null, updatedAt: new Date(now()) }).where(eq(strategyRules.id, rule.id));
          continue;
        }
        const at = new Date(now());
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
            creds = await openCredential(deps, user, strategy.brokerId ?? "");
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
          const reason = rule.kind === "stop" ? ("stopped" as const) : ("target" as const);
          const batchId = `rule:${rule.id}`;
          // short legs first: buying them back frees margin and never leaves a naked side
          const order = [...legs].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
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
          const note = `${label} fired at P&L ${toDecimal(pnl, 2)} USD: ${parts.join(", ")}`;
          await deps.db.update(strategyRules).set({ outcome, note, updatedAt: at }).where(eq(strategyRules.id, rule.id));
          // the other rule of the strategy is moot now
          await disarmRules(deps, strategy.id, `disarmed: the ${label.toLowerCase()} fired`, at);
          await deps.db.insert(strategyAdjustments).values({ id: newId("adj"), strategyId: strategy.id, batchId, reason: note, added: 0, trimmed: 0, closed: fills.length, realizedPnl: batchPnl, createdAt: at });
          const realized = addDecimal(await freshTotal(deps, strategy.id, strategy.realizedPnl), batchPnl);
          const left = await deps.db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).limit(1);
          const archive = left.length === 0;
          await deps.db
            .update(strategies)
            .set({ realizedPnl: realized, updatedAt: at, ...(archive ? { status: "archived" as const, closedAt: at, closeReason: reason } : {}) })
            .where(eq(strategies.id, strategy.id));
          await writeAudit(deps.db, {
            actorId: null,
            action: "strategy.rule_fire",
            target: `strategy:${strategy.id}`,
            before: { rule: rule.id, kind: rule.kind, thresholdUsd: rule.thresholdUsd, pnl: toDecimal(pnl, 2), marks: legs.map((l) => ({ symbol: l.symbol, mark: marks.get(l.symbol), entry: l.entryPrice })) },
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
        break; // one fire per strategy per tick; its other rule is disarmed above
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

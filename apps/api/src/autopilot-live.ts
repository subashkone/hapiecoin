/**
 * Autopilot's live entry (ADR-148; HC-TR-299..306): the one place where Autopilot may send a real order. It runs only
 * when the server switch hands it to the engine (`config.autopilotLive`: AUTOPILOT_LIVE=testnet AND a trading host that
 * is not a real exchange), and only for a trader who holds an ACTIVE mandate (ADR-147) for a saved strategy that may
 * trade live. In every other case the engine enters on paper exactly as before.
 *
 * The order of things:
 *   1. No active mandate, no account, or a strategy that may not trade live (approval withdrawn, retired, unreadable):
 *      "paper". The engine goes on to its paper entry as if this module did not exist.
 *   2. From there the entry is live or nothing on this pass. Every refusal of the gate is a skip line that starts
 *      "Live:" and sends no order.
 *   3. The strategy row is written as LIVE first, under the same one-at-a-time index as a paper trade, with the
 *      approval read again inside that write. Then one market order per leg, buys before sells, and the loop STOPS at
 *      the first leg that did not fill completely: a sold option never goes out after a bought one failed.
 *   4. Every leg filled: the exits are armed. Anything else: nothing is retried, nothing is closed, the mandate is
 *      paused with the reason, and it is written to the log and the audit trail. The legs the loop never sent an order
 *      for are taken off the trade (no order is sent for that); a leg that has an order of any state stays, because a
 *      refused or failed order can still turn out filled. What is held then is loss-limited by its structure (only strategies whose loss is capped can hold a mandate, and their bought options went first).
 *
 * The exchange key is opened only through `resolveAccount`, the app's own path. Amounts are compared in cents.
 */
import type { PlaybookProposal } from "@hapiecoin/pricing";
import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import type { LiveEntryContext, LiveHook } from "./autopilot.js";
import { liveRefusalOf } from "./autopilot-mandate.js";
import { autopilotMandates, autopilotRuns, autopilotSavedStrategies, brokerCredentials, strategies, strategyLegs, strategyOrders, users } from "./db/schema.js";
import { assertEntitled } from "./entitlements.js";
import { type LegRow, type StrategyRow, placeEntries, planLegs, preview, resolveAccount, tradingBlockedReason } from "./routes/live-exec.js";
import type { AppDeps } from "./routes/shared.js";
import type { SessionUser } from "./security/context.js";

const DAY_MS = 86_400_000;
/** A live entry older than this whose legs have not all filled is incomplete, whatever became of the pass that opened it. */
export const LIVE_ENTRY_GRACE_MS = 2 * 60_000;
export const liveOrderKey = (accountId: string): string => `autopilot:orders:account:${accountId}`;
const cents = (usd: string | number): number => Math.round(Number(usd) * 100);
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 00:00 UTC of the day `at` is in, and of the Monday of its week: where the mandate's loss limits start counting. */
export function lossWindows(at: Date): { day: Date; week: Date } {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return { day, week: new Date(day.getTime() - sinceMonday * DAY_MS) };
}

type Mandate = typeof autopilotMandates.$inferSelect;

/** What the mandate's own trades say: how many are open, the margin they were entered with, and what closed at a loss since each window began. In cents. */
async function mandateBook(deps: Pick<AppDeps, "db">, mandateId: string, at: Date): Promise<{ open: number; openMarginCents: number | null; dayCents: number; weekCents: number }> {
  const { day, week } = lossWindows(at);
  const open = await deps.db.select({ margin: strategies.marginEstimate }).from(strategies).where(and(eq(strategies.autopilotMandateId, mandateId), eq(strategies.status, "live")));
  const closed = await deps.db.select({ pnl: strategies.realizedPnl, closedAt: strategies.closedAt }).from(strategies).where(and(eq(strategies.autopilotMandateId, mandateId), eq(strategies.status, "archived"), gte(strategies.closedAt, week)));
  const sum = (from: Date) => closed.filter((c) => c.closedAt !== null && c.closedAt.getTime() >= from.getTime()).reduce((n, c) => n + cents(c.pnl ?? "0"), 0);
  return { open: open.length, openMarginCents: open.some((o) => o.margin === null) ? null : open.reduce((n, o) => n + cents(o.margin!), 0), dayCents: sum(day), weekCents: sum(week) };
}

/**
 * Take off an incomplete live entry the legs Autopilot PROVABLY never sent an order for: the ones the order loop did
 * not reach, named by the loop itself. Each is checked again here: still open, no entry price, and not one order row of
 * any state. They are closed without a price and without a result, so that squaring the trade off by hand sends nothing
 * for them. A leg that has an order row is NEVER touched, whatever the row says: refused, failed and unknown can each
 * turn out filled at the exchange (a gateway error after acceptance, a fill whose record was lost). A trade none of
 * whose legs was ever sent held nothing and is closed. No order is sent here.
 *
 * The sweep and the unexpected-error path pass no legs: nobody can say there what reached the exchange, so nothing is
 * taken off and nothing is closed.
 */
async function dropNeverSent(deps: Pick<AppDeps, "db">, strategyId: string, neverSent: readonly string[], at: Date): Promise<{ dropped: number; left: number }> {
  const open = await deps.db.select({ id: strategyLegs.id, entryPrice: strategyLegs.entryPrice }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategyId), eq(strategyLegs.status, "open")));
  const ordered = new Set((await deps.db.select({ legId: strategyOrders.legId }).from(strategyOrders).where(eq(strategyOrders.strategyId, strategyId))).map((o) => o.legId));
  const drop = open.filter((l) => neverSent.includes(l.id) && l.entryPrice === null && !ordered.has(l.id)).map((l) => l.id);
  if (drop.length) await deps.db.update(strategyLegs).set({ status: "squared_off", closeReason: "squared_off", closedAt: at, updatedAt: at }).where(inArray(strategyLegs.id, drop));
  const left = open.length - drop.length;
  // closed only when no order of this trade ever existed: with one, something may be held whatever the legs say
  if (drop.length > 0 && left === 0 && ordered.size === 0) await deps.db.update(strategies).set({ status: "archived", closedAt: at, closeReason: "squared_off", updatedAt: at }).where(and(eq(strategies.id, strategyId), eq(strategies.status, "live")));
  return { dropped: drop.length, left };
}

/**
 * Pause a mandate that is active, with the reason, and say so in the log and the audit trail. A mandate already paused
 * or ended is left as it is. `neverSent` are the legs the order loop did not reach (see `dropNeverSent`).
 */
async function pauseFor(deps: Pick<AppDeps, "db" | "logger">, m: Pick<Mandate, "id">, key: LiveEntryContext["key"], strategyId: string, why: string, at: Date, neverSent: readonly string[] = []): Promise<void> {
  const { dropped, left } = await dropNeverSent(deps, strategyId, neverSent, at);
  const off = dropped === 0 ? "" : ` ${dropped} ${dropped === 1 ? "leg that was never sent to the exchange was" : "legs that were never sent to the exchange were"} taken off the trade.`;
  const rest = left === 0 ? " Nothing was sent, so nothing is held and the trade is closed" : ` ${left} ${left === 1 ? "leg stays" : "legs stay"} on the trade: check what the exchange holds and square it off`;
  const reason = `Live entry incomplete: ${why}. No order was retried and none was sent to close anything.${off}${rest}; this mandate is paused`;
  const paused = await deps.db
    .update(autopilotMandates)
    .set({ state: "paused", pausedAt: at, pauseReason: reason.slice(0, 500), updatedAt: at })
    .where(and(eq(autopilotMandates.id, m.id), eq(autopilotMandates.state, "active")))
    .returning({ id: autopilotMandates.id });
  await deps.db.insert(autopilotRuns).values({ ...key, kind: "noted", reason: reason.slice(0, 500), strategyId, detail: { mode: "live", mandateId: m.id }, at });
  await writeAudit(deps.db, { actorId: null, action: "autopilot.live_incomplete", target: `strategy:${strategyId}`, before: null, after: { mandateId: m.id, why, mandatePaused: paused.length > 0 } });
  deps.logger.warn({ strategyId, mandateId: m.id, why }, "autopilot live entry incomplete; mandate paused");
}

/** The live entry as the engine's hook. Built only by the caller that read the server switch. */
export function liveEntryHook(deps: AppDeps): LiveHook {
  return async (ctx) => {
    const { key, playbook: p, at } = ctx;
    const [m] = await deps.db
      .select()
      .from(autopilotMandates)
      .where(and(eq(autopilotMandates.userId, key.userId), eq(autopilotMandates.strategyId, p.id), eq(autopilotMandates.state, "active"), isNotNull(autopilotMandates.accountId)))
      .limit(1);
    if (!m || m.accountId === null) return "paper";
    const [row] = await deps.db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, p.id)).limit(1);
    if (liveRefusalOf(row) !== null) return "paper";
    const [account] = await deps.db
      .select({ id: brokerCredentials.id, brokerId: brokerCredentials.brokerId })
      .from(brokerCredentials)
      .where(and(eq(brokerCredentials.id, m.accountId), eq(brokerCredentials.userId, key.userId)))
      .limit(1);
    const [u] = await deps.db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, key.userId)).limit(1);
    if (!account || !u) return "paper";
    const user: SessionUser = u;

    // ---- from here the entry is live or nothing on this pass ----
    const no = async (reason: string, proposal?: PlaybookProposal): Promise<"handled"> => {
      await ctx.skip(`Live: ${reason}`.slice(0, 500), { ...(proposal ? ctx.detailOf(proposal, null) : {}), mode: "live", mandateId: m.id });
      return "handled";
    };
    const blocked = await tradingBlockedReason(deps, user);
    if (blocked) return no(blocked);
    // an entry under this mandate that never completed is squared off first: nothing new goes on top of it
    if (await hasIncompleteEntry(deps.db, m.id)) return no("a trade entered under this mandate did not complete: square it off first");
    const { result, plan } = ctx.priceWith(m.lots);
    if (!result.ok || !plan) return no(`no entry at the mandate's ${m.lots} lots on these prices`);
    const proposal = result.proposal;
    try {
      await assertEntitled(deps, user.id, "live_trading", at);
    } catch (e) {
      return no(errorText(e), proposal);
    }
    const book = await mandateBook(deps, m.id, at);
    if (book.open >= m.maxOpen) return no(`${book.open} live ${book.open === 1 ? "trade is" : "trades are"} open under this mandate, its limit`, proposal);
    if (-book.dayCents >= m.dayLossLimitUsd * 100) return no(`the mandate's loss limit for the day (${m.dayLossLimitUsd} USD, counted from 00:00 UTC on closed trades) is reached`, proposal);
    if (-book.weekCents >= m.weekLossLimitUsd * 100) return no(`the mandate's loss limit for the week (${m.weekLossLimitUsd} USD, counted from Monday 00:00 UTC on closed trades) is reached`, proposal);
    const margin = await ctx.marginOf(proposal);
    if (margin === null || book.openMarginCents === null) return no("the margin of this trade could not be estimated", proposal);
    // (the reasons carry no figure that moves with the market: a refusal that lasts is written once, not every pass)
    if (cents(margin) + book.openMarginCents > m.maxCapitalUsd * 100) return no(`the estimated margin of this trade, with the mandate's open trades, is above the mandate's capital of ${m.maxCapitalUsd} USD`, proposal);

    // the exchange's own word, through the checks every live placement passes (state of each contract, whole contracts,
    // the per-placement caps, the wallet against the margin): a read that fails is a refusal, never "enough"
    const symbols = ctx.symbolsOf(proposal);
    const asRow = { id: "pending", userId: key.userId, venue: key.venue, asset: key.asset } as StrategyRow;
    const asLegs = proposal.legs.map((l, i) => ({ id: `pending-${i}`, symbol: symbols[i]!, side: l.side, lots: l.lots }));
    const checked = await preview(deps, user, asRow, asLegs, account.brokerId, null, [], account.id);
    if (!checked.ok) return no(checked.reasons.join(" · "), proposal);
    if (checked.available === null) return no("the exchange wallet shows no balance to trade from", proposal);
    if (proposal.legs.some((l) => l.side === "sell") && checked.marginRequired === null) return no("the exchange gave no margin parameters for the sold options", proposal);
    const band = deps.config.trading.markBandPct / 100;
    for (const [i, l] of proposal.legs.entries()) {
      const mark = checked.legs[i]?.mark ?? null;
      if (mark === null || !(Number(mark) > 0) || !(Number(l.price) > 0)) return no(`${symbols[i]!} has no price at the exchange or on the snapshot`, proposal);
      if (Math.abs(Number(mark) - Number(l.price)) / Number(l.price) > band) return no(`the price of ${symbols[i]!} at the exchange is beyond the ${deps.config.trading.markBandPct} % band around the snapshot's`, proposal);
    }
    // an order budget of its own per account (the HTTP order limit never sees the engine)
    for (let i = 0; i < proposal.legs.length; i++) {
      if (!(await deps.rateStore.consume(liveOrderKey(account.id), 60_000, deps.config.orderRateMaxPerMin)).allowed) return no("the order rate limit of this account is reached; waiting for the next pass", proposal);
    }

    // ---- the write, then the orders ----
    const opened = await ctx.open(proposal, plan, { brokerId: account.brokerId, accountId: account.id, mandateId: m.id }, margin);
    deps.logger.info({ userId: key.userId, playbookId: p.id, venue: key.venue, asset: key.asset, strategyId: opened.id, mandateId: m.id }, "autopilot opened a LIVE trade; placing its orders");
    try {
      const [strategy] = await deps.db.select().from(strategies).where(eq(strategies.id, opened.id)).limit(1);
      const legs: LegRow[] = await deps.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, opened.id)).orderBy(strategyLegs.position);
      const sized = await planLegs(deps, legs, ctx.lotSize, key.venue);
      // a contract that left trading, or stopped sizing, between the gate and here: nothing is sent at all
      if (sized.reasons.length > 0) {
        await pauseFor(deps, m, key, opened.id, `${sized.reasons.join("; ")}; no order was sent`, at, legs.map((l) => l.id));
        return "handled";
      }
      const { creds } = await resolveAccount(deps, user, account.brokerId, key.venue, account.id);
      const ordered = [...legs].sort((a, b) => (a.side === b.side ? 0 : a.side === "buy" ? -1 : 1));
      for (const [i, leg] of ordered.entries()) {
        const out = await placeEntries(deps, creds, strategy!, [leg], sized.legs, `ap-${opened.id}`, "entry", {});
        if (out.filled !== 1) {
          // the legs after this one were never sent; this one was, and keeps its place whatever its order says
          await pauseFor(deps, m, key, opened.id, `${leg.symbol} did not fill (${out.errors.join("; ") || (out.pending ? "the order is still open at the exchange" : "no fill")}); ${i} of ${legs.length} legs filled before it`, at, ordered.slice(i + 1).map((l) => l.id));
          return "handled";
        }
      }
    } catch (e) {
      // nobody can say here what reached the exchange: nothing is taken off the trade
      await pauseFor(deps, m, key, opened.id, `${errorText(e)} (an order may or may not have reached the exchange)`, at);
      return "handled";
    }
    // every leg filled: arm the exits and mark the entry complete. A failure here is said in its own words: the trade is
    // whole, and without its mark the mandate enters nothing new until the trader has looked at it
    try {
      await opened.armExits();
      await deps.db.update(strategies).set({ autopilotEntryCompleteAt: new Date(), updatedAt: new Date() }).where(eq(strategies.id, opened.id));
    } catch (e) {
      await pauseFor(deps, m, key, opened.id, `every leg filled, but arming its exits or marking it complete failed (${errorText(e)}): check its exits`, at);
      return "handled";
    }
    await writeAudit(deps.db, { actorId: null, action: "autopilot.live_filled", target: `strategy:${opened.id}`, before: null, after: { mandateId: m.id, accountId: account.id, legs: proposal.legs.length } });
    return "handled";
  };
}

/**
 * The entries a pass did not finish: a live Autopilot trade past its grace that never got its mark of completion (a leg
 * did not fill, the server stopped between the row and its orders, or between the last fill and the arming of the
 * exits) pauses its mandate if that is still active. Nothing is sent or closed. A trade that completed is never looked
 * at again, whatever the trader adds to it or rolls later.
 */
export async function sweepIncompleteLive(deps: Pick<AppDeps, "db" | "logger">, now: Date): Promise<number> {
  const rows = await deps.db
    .select({ id: strategies.id, userId: strategies.userId, playbookId: strategies.autopilotPlaybookId, venue: strategies.venue, asset: strategies.asset, mandateId: strategies.autopilotMandateId })
    .from(strategies)
    .innerJoin(autopilotMandates, eq(autopilotMandates.id, strategies.autopilotMandateId))
    .where(and(eq(strategies.status, "live"), isNotNull(strategies.autopilotPlaybookId), isNull(strategies.autopilotEntryCompleteAt), eq(autopilotMandates.state, "active"), lt(strategies.createdAt, new Date(now.getTime() - LIVE_ENTRY_GRACE_MS))));
  for (const r of rows) await pauseFor(deps, { id: r.mandateId! }, { userId: r.userId, playbookId: r.playbookId!, venue: r.venue, asset: r.asset }, r.id, "the entry was not finished by the pass that opened it", now);
  return rows.length;
}

/** Whether a mandate has a live trade whose entry never completed: it is squared off before the mandate enters anything again. */
export async function hasIncompleteEntry(db: Pick<AppDeps["db"], "select">, mandateId: string): Promise<boolean> {
  const [row] = await db.select({ id: strategies.id }).from(strategies).where(and(eq(strategies.autopilotMandateId, mandateId), eq(strategies.status, "live"), isNull(strategies.autopilotEntryCompleteAt))).limit(1);
  return row !== undefined;
}

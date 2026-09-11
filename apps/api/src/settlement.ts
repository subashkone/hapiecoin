// Expiry settlement (ADR-059 §2.4; HC-TR-162 paper, HC-TR-163 live; GAPS #66). Every `intervalMs` the API walks the
// open legs of paper and live strategies whose settlement instant has passed (Delta settles BTC / ETH options at
// 12:00 UTC and XAUT at 16:00 UTC, plus a short grace) and books them closed at their settlement value: the intrinsic
// value at the spot of the settlement instant (a dated future settles at the spot itself). Paper legs settle
// directly. A live leg is settled only after a successful exchange positions read shows the contract gone: the
// exchange settles it itself, HapieCoin does the bookkeeping, and an unreadable exchange books nothing on a guess.
// Without a spot for the instant the leg stays open and is retried on the next pass. Never runs under NODE_ENV=test
// unless a test calls `settleExpired` itself.
import { type Underlying, type Venue, settlementMsOf, toDecimal } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import { ivSnapshots, strategies, strategyAdjustments, strategyLegs } from "./db/schema.js";
import { lotSizeFor, openCredential } from "./routes/live-exec.js";
import { type AppDeps, errorMessage, newId } from "./routes/shared.js";
import { addDecimal, closeLegRow, disarmRules, freshTotal } from "./routes/strategies.js";

/** Legs settle this long after the instant, so a snapshot taken at the minute can land first. */
export const SETTLEMENT_GRACE_MS = 2 * 60_000;

export interface SettlementSource {
  /** The underlying's spot at the settlement instant on `venue` (the default venue when absent), or null when nothing trustworthy is known yet. */
  spotAt(asset: Underlying, settlementMs: number, venue?: Venue): Promise<number | null>;
}

export interface SettlementReport {
  /** Strategies with at least one leg past settlement. */
  strategies: number;
  /** Legs booked closed. */
  settled: number;
  /** Strategies archived because nothing stayed open. */
  archived: number;
  /** Legs left open for the next pass (no spot, exchange still holds them, exchange unreadable). */
  skipped: number;
}

/** Settlement value per underlying unit: intrinsic for options, the spot for a dated future. */
export function intrinsicAt(leg: { kind: "call" | "put" | "future"; strike: string }, spot: number): number {
  if (leg.kind === "future") return spot;
  const strike = Number(leg.strike);
  return Math.max(0, leg.kind === "call" ? spot - strike : strike - spot);
}

/** One pass; failures are logged per strategy and never thrown. */
export async function settleExpired(
  deps: AppDeps,
  source: SettlementSource,
  now: () => number = Date.now,
): Promise<SettlementReport> {
  const nowMs = now();
  const today = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD compares lexically; a later expiry cannot be due
  const rows = await deps.db
    .select({ strategy: strategies, leg: strategyLegs })
    .from(strategyLegs)
    .innerJoin(strategies, eq(strategyLegs.strategyId, strategies.id))
    .where(
      and(
        inArray(strategies.status, ["paper", "live"]),
        eq(strategyLegs.status, "open"),
        ne(strategyLegs.expiry, "PERP"),
        lte(strategyLegs.expiry, today),
      ),
    );
  type Row = (typeof rows)[number];
  const due = new Map<
    string,
    { strategy: Row["strategy"]; legs: { leg: Row["leg"]; settlementMs: number }[] }
  >();
  for (const { strategy, leg } of rows) {
    const ms = settlementMsOf(leg.expiry, strategy.asset);
    if (ms === null || ms + SETTLEMENT_GRACE_MS > nowMs) continue;
    const entry = due.get(strategy.id) ?? { strategy, legs: [] };
    entry.legs.push({ leg, settlementMs: ms });
    due.set(strategy.id, entry);
  }
  const out: SettlementReport = { strategies: due.size, settled: 0, archived: 0, skipped: 0 };
  const spots = new Map<string, number | null>();
  const spotFor = async (asset: Underlying, ms: number, venue: Venue): Promise<number | null> => {
    const key = `${venue}:${asset}:${ms}`;
    if (!spots.has(key)) spots.set(key, await source.spotAt(asset, ms, venue));
    return spots.get(key) ?? null;
  };
  for (const { strategy, legs } of due.values()) {
    try {
      // live: only a contract the exchange no longer holds is settled; a failed read throws and books nothing
      let gone: Set<string> | null = null;
      if (strategy.status === "live") {
        if (!strategy.brokerId) {
          out.skipped += legs.length;
          continue;
        }
        const user = { id: strategy.userId, email: "", name: "", role: "user" as const };
        const creds = await openCredential(deps, user, strategy.brokerId, undefined, strategy.accountId);
        const positions = await deps.trading.getPositions(creds);
        if (positions.some((p) => p.size !== 0 && !p.symbol)) {
          // a position the venue could not name might be one of ours: the read says nothing usable, book nothing
          out.skipped += legs.length;
          deps.logger.info(
            { strategyId: strategy.id },
            "settlement: a venue position has no symbol; strategy left for the next pass",
          );
          continue;
        }
        const held = new Set(
          positions.filter((p) => p.size !== 0 && p.symbol).map((p) => p.symbol as string),
        );
        gone = new Set(legs.map((x) => x.leg.symbol).filter((s) => !held.has(s)));
      }
      const lotSize = await lotSizeFor(
        deps,
        { id: strategy.userId, email: "", name: "", role: "user" },
        strategy.asset,
      );
      const at = new Date(nowMs);
      let batchPnl = "0";
      let booked = 0;
      const notes: string[] = [];
      for (const { leg: seen, settlementMs } of legs) {
        if (gone && !gone.has(seen.symbol)) {
          out.skipped += 1; // the exchange still holds it: its settlement is not through yet
          continue;
        }
        // the spot read is the last await before the write, so the leg is re-read after it: the trader may have
        // closed the leg since the pass started (an exit, an adjustment, Reconcile) and that close must stand
        const spot = seen.entryPrice === null ? null : await spotFor(strategy.asset, settlementMs, strategy.venue);
        if (seen.entryPrice !== null && spot === null) {
          out.skipped += 1;
          continue;
        }
        const [leg] = await deps.db
          .select()
          .from(strategyLegs)
          .where(and(eq(strategyLegs.id, seen.id), eq(strategyLegs.status, "open")))
          .limit(1);
        if (!leg) {
          out.skipped += 1;
          continue;
        }
        if (leg.entryPrice === null) {
          // a live entry that never filled (a refused or resting order the venue cancels at expiry): closed, no P&L
          await deps.db
            .update(strategyLegs)
            .set({ status: "squared_off", closeReason: "expired", closedAt: at, updatedAt: at })
            .where(eq(strategyLegs.id, leg.id));
          booked += 1;
          notes.push(`${leg.symbol} never filled`);
          continue;
        }
        if (spot === null) {
          out.skipped += 1; // filled since the pass started and no spot for it: next pass
          continue;
        }
        const price = toDecimal(intrinsicAt(leg, spot), 2);
        const pnl = await closeLegRow(deps, strategy, leg, price, undefined, lotSize, at, "expired");
        batchPnl = addDecimal(batchPnl, pnl);
        booked += 1;
        notes.push(`${leg.symbol} at ${price} (spot ${toDecimal(spot, 2)})`);
      }
      if (booked === 0) continue;
      out.settled += booked;
      // the Details history shows the settlement like any other batch (ADR-044)
      await deps.db
        .insert(strategyAdjustments)
        .values({
          id: newId("adj"),
          strategyId: strategy.id,
          batchId: `settle:${newId("b")}`,
          reason: `expired · settled ${notes.join(", ")}`,
          added: 0,
          trimmed: 0,
          closed: booked,
          realizedPnl: batchPnl,
          createdAt: at,
        });
      const left = await deps.db
        .select({ id: strategyLegs.id })
        .from(strategyLegs)
        .where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open")))
        .limit(1);
      const archive = left.length === 0;
      // the running total is re-read now: a close the trader booked during this pass must not be overwritten
      const runningPnl = await freshTotal(deps, strategy.id, strategy.realizedPnl);
      const realized = addDecimal(runningPnl, batchPnl);
      await deps.db
        .update(strategies)
        .set({
          realizedPnl: realized,
          updatedAt: at,
          ...(archive ? { status: "archived" as const, closedAt: at, closeReason: "expired" as const } : {}),
        })
        .where(eq(strategies.id, strategy.id));
      if (archive) {
        out.archived += 1;
        await disarmRules(deps, strategy.id, "disarmed: the strategy expired", at);
      }
      await writeAudit(deps.db, {
        actorId: null,
        action: "strategy.settle",
        target: `strategy:${strategy.id}`,
        before: { status: strategy.status, realizedPnl: runningPnl },
        after: { status: archive ? "archived" : strategy.status, realizedPnl: realized, settled: notes },
      });
    } catch (e) {
      out.skipped += legs.length;
      // info, not warn: a removed credential or an unreadable exchange repeats every pass until the trader reconciles
      deps.logger.info(
        { strategyId: strategy.id, err: errorMessage(e) },
        "settlement: strategy skipped",
      );
    }
  }
  if (out.strategies) deps.logger.info(out, "settlement: expired legs checked");
  return out;
}

/**
 * The spot at a settlement instant: the IV-history snapshot nearest the instant within `windowMs` (ADR-056 writes one
 * every few minutes), else the venue's live spot while the instant is still within the window, else null.
 */
export function snapshotSpotSource(
  deps: Pick<AppDeps, "db">,
  live: (asset: Underlying) => Promise<number | null>,
  now: () => number = Date.now,
  windowMs = 30 * 60_000,
): SettlementSource {
  return {
    async spotAt(asset, settlementMs, venue = DEFAULT_VENUE) {
      const rows = await deps.db
        .select({ spot: ivSnapshots.spot, ts: ivSnapshots.ts })
        .from(ivSnapshots)
        .where(
          and(
            eq(ivSnapshots.venue, venue),
            eq(ivSnapshots.asset, asset),
            gte(ivSnapshots.ts, new Date(settlementMs - windowMs)),
            lte(ivSnapshots.ts, new Date(settlementMs + windowMs)),
          ),
        );
      let best: { spot: number; distance: number } | null = null;
      for (const r of rows) {
        const spot = Number(r.spot);
        const distance = Math.abs(r.ts.getTime() - settlementMs);
        if (spot > 0 && (best === null || distance < best.distance)) best = { spot, distance };
      }
      if (best) return best.spot;
      if (now() - settlementMs <= windowMs) {
        const spot = await live(asset).catch(() => null);
        if (spot !== null && spot > 0) return spot;
      }
      return null;
    },
  };
}

/** Start the periodic pass; returns the stop function. Overlapping passes are skipped. */
export function startSettler(deps: AppDeps, source: SettlementSource, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await settleExpired(deps, source);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

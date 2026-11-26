// Runs of the backtest in the app, as rows (ADR-144; HC-TR-288): one is started for a saved strategy, works in the
// background of this process while its row says how far it is, and ends done or failed with what it found. Its
// figures can be put on the strategy while the strategy still has the settings the run tested; they then carry the
// run's period, prices and limits, where typed figures carry none. A run that stopped reporting (the process was
// restarted under it) is read as failed. Paper arithmetic only.
import { SAVED_REFUSALS, type SavedBacktest, type SavedBacktestRun, type SavedBacktestStart, type SavedStrategy } from "@hapiecoin/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { type SavedResult, putSavedBacktest } from "./autopilot-saved.js";
import type { Db } from "./db/client.js";
import { autopilotSavedBacktests } from "./db/schema.js";
import type { MarkSource } from "./mark-candles.js";
import { errorMessage, newId } from "./routes/shared.js";
import { BacktestRefused, backtestRefusal, backtestSaved, resolutionOf } from "./saved-backtest.js";

type Row = typeof autopilotSavedBacktests.$inferSelect;
/** A running row not touched for this long has lost its process. */
export const RUN_STALE_MS = 15 * 60_000;
/** The row's progress is written at most this often while a run works. */
const PROGRESS_EVERY_MS = 2_000;
/** Runs kept in a strategy's list. */
export const RUNS_LISTED = 5;
const INTERRUPTED = "The backtest was interrupted before it finished: run it again";
/** JSON with its keys in order, to compare settings whatever order they were stored in. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export interface RunDeps {
  db: Db;
  source: MarkSource;
  now: () => number;
  logger: { warn: (obj: object, msg: string) => void };
}

function toRun(row: Row, strategy: Pick<SavedStrategy, "definition">, nowMs: number): SavedBacktestRun {
  const lost = row.status === "running" && nowMs - row.updatedAt.getTime() > RUN_STALE_MS;
  return { id: row.id, strategyId: row.strategyId, status: lost ? "failed" : row.status, progress: row.progress, ...row.result, error: lost ? INTERRUPTED : row.error, current: stable(row.definition) === stable(strategy.definition), createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null };
}

/** The latest runs of a strategy, newest first. */
export async function runsOf(db: Db, strategy: SavedStrategy, nowMs: number): Promise<SavedBacktestRun[]> {
  const rows = await db.select().from(autopilotSavedBacktests).where(eq(autopilotSavedBacktests.strategyId, strategy.id)).orderBy(desc(autopilotSavedBacktests.createdAt)).limit(RUNS_LISTED);
  return rows.map((r) => toRun(r, strategy, nowMs));
}

export type StartResult = { ok: true; run: SavedBacktestRun; finished: Promise<void> } | { ok: false; why: string };
/** Start a run on the strategy's settings as they are now. The answer is the row as it starts; `finished` resolves when the work has ended (tests wait on it). */
export async function startRun(deps: RunDeps, strategy: SavedStrategy, range: SavedBacktestStart, userId: string): Promise<StartResult> {
  const refused = backtestRefusal(strategy.definition);
  if (refused) return { ok: false, why: refused };
  const nowMs = deps.now();
  const at = new Date(nowMs);
  const [working] = await deps.db
    .select({ id: autopilotSavedBacktests.id })
    .from(autopilotSavedBacktests)
    .where(and(eq(autopilotSavedBacktests.strategyId, strategy.id), eq(autopilotSavedBacktests.status, "running"), gt(autopilotSavedBacktests.updatedAt, new Date(nowMs - RUN_STALE_MS))))
    .limit(1);
  if (working) return { ok: false, why: SAVED_REFUSALS.backtestRunning };
  const today = at.toISOString().slice(0, 10);
  const [row] = await deps.db
    .insert(autopilotSavedBacktests)
    .values({ id: newId("bt"), strategyId: strategy.id, status: "running", definition: strategy.definition, progress: { done: 0, total: 0 }, result: { from: range.from ?? today, to: range.to ?? today, resolution: resolutionOf(strategy.definition), figures: null, noEntry: {}, barsJudged: 0, barsSkipped: 0, notes: [], trades: [] }, createdBy: userId, createdAt: at, updatedAt: at })
    .returning();
  const id = row!.id;
  const mine = eq(autopilotSavedBacktests.id, id);
  const end = async (set: Partial<Row>) => {
    const ended = new Date(deps.now());
    await deps.db.update(autopilotSavedBacktests).set({ ...set, finishedAt: ended, updatedAt: ended }).where(mine);
  };
  const work = async () => {
    let wrote = nowMs;
    let result;
    try {
      result = await backtestSaved(
        {
          db: deps.db,
          source: deps.source,
          now: deps.now,
          onProgress: async (done, total) => {
            if (deps.now() - wrote < PROGRESS_EVERY_MS && done < total) return;
            wrote = deps.now();
            await deps.db.update(autopilotSavedBacktests).set({ progress: { done, total }, updatedAt: new Date(wrote) }).where(mine);
          },
        },
        strategy,
        range,
      );
    } catch (e) {
      // a refusal is the answer; anything else is a failure to say plainly, with its cause in the log
      if (!(e instanceof BacktestRefused)) deps.logger.warn({ run: id, strategy: strategy.id, reason: errorMessage(e) }, "saved backtest failed");
      return end({ status: "failed", error: e instanceof BacktestRefused ? e.message : "The backtest could not be completed: the price history could not be read. Try again later." });
    }
    return end({ status: "done", result });
  };
  // nobody waits on a run in production: a write that fails at its end is logged here, and the row then reads as interrupted
  const finished = work().catch((e: unknown) => deps.logger.warn({ run: id, strategy: strategy.id, reason: errorMessage(e) }, "saved backtest could not write its end"));
  return { ok: true, run: toRun(row!, strategy, nowMs), finished };
}

/** Put a finished run's figures on its strategy, marked as computed in the app. Refused when the settings have changed since, or when the run made no trade. */
export async function useRun(db: Db, strategy: SavedStrategy, runId: string, at: Date): Promise<SavedResult | null> {
  const [row] = await db.select().from(autopilotSavedBacktests).where(and(eq(autopilotSavedBacktests.id, runId), eq(autopilotSavedBacktests.strategyId, strategy.id))).limit(1);
  if (!row || row.status !== "done") return null;
  const r = row.result;
  if (!r.figures) return { ok: false, why: SAVED_REFUSALS.backtestEmpty };
  const backtest: SavedBacktest = { ...r.figures, run: { id: row.id, from: r.from, to: r.to, resolution: r.resolution, notes: r.notes } };
  return putSavedBacktest(db, strategy.id, row.definition, backtest, at);
}

/**
 * Playbook records (ADR-101; HC-TR-205): for every playbook and asset on a venue, the engine run over the whole
 * recorded chain history with the playbook's plan (net of the venue's fee rule, two folds for the in-sample /
 * out-of-sample split), summarised into one stored row, recomputed whenever the recorded history changed (a newer
 * day, or more days behind it from the candle backfill, or a day re-recorded live: the stamp is last day plus day
 * count, as the day cache's is). The job runs leader-only (ADR-062): once at start, then every `intervalMs`. Public
 * data only, no key, no order path.
 */
import { PLAYBOOKS, type Playbook, calendarFor, losingYearsOf, playbookOptions, playbookStatus, playbookTemplate, runBacktest, type EodDay } from "@hapiecoin/pricing";
import type { PlaybookRecord, Underlying, Venue } from "@hapiecoin/schema";
import { projectPlaybookRecord } from "@hapiecoin/schema";
import { defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { and, eq } from "drizzle-orm";
import { eodDaysCached } from "./chain-eod.js";
import type { Db } from "./db/client.js";
import { playbookRecords } from "./db/schema.js";

export const PLAYBOOK_ASSETS: readonly Underlying[] = ["BTC", "ETH"];

export interface PlaybookRecordDeps {
  db: Db;
  logger: { info(o: object, msg: string): void; warn(o: object, msg: string): void };
  now?: (() => number) | undefined;
}

/** One playbook's record over the recorded days of a venue and asset; null when its template cannot be resolved. */
export function computePlaybookRecord(p: Playbook, days: readonly EodDay[], venue: Venue, asset: Underlying, computedAt: Date): PlaybookRecord | null {
  const tpl = playbookTemplate(p);
  if (!tpl) return null;
  const adapter = getVenue(venue);
  const r = runBacktest(tpl, days, playbookOptions(p, { unitsPerLot: Number(defaultLotSizes(adapter)[asset]), calendar: calendarFor(adapter.calendar.settlementHourUtc(asset)), fees: adapter.feeRule }));
  return projectPlaybookRecord({
    computedAt: computedAt.toISOString(),
    firstDay: r.coverage.firstDay,
    lastDay: r.coverage.lastDay,
    days: r.coverage.days,
    reconstructedDays: r.coverage.reconstructedDays,
    entries: r.coverage.entries,
    noSignal: r.coverage.skipped.noSignal,
    stats: r.stats,
    folds: r.folds ?? [],
    losingYears: losingYearsOf(r.trades),
    exits: r.coverage.exits,
    trials: p.trials.count,
    status: playbookStatus(p, r.stats, r.folds),
    fees: adapter.feeRule ? "venue" : "none",
  });
}

/**
 * Bring every playbook's record up to the latest recorded day for the venues given: a record whose `lastDay` already
 * equals the latest recorded day is left alone, the rest are recomputed and upserted. Returns the counts.
 */
export async function refreshPlaybookRecords(deps: PlaybookRecordDeps, venues: readonly Venue[]): Promise<{ computed: number; skipped: number; noData: number; failed: number }> {
  const now = new Date(deps.now?.() ?? Date.now());
  const totals = { computed: 0, skipped: 0, noData: 0, failed: 0 };
  for (const venue of venues) {
    for (const asset of PLAYBOOK_ASSETS) {
      const days = await eodDaysCached(deps.db, venue, asset);
      const latest = days.at(-1)?.day;
      if (latest === undefined) {
        totals.noData += 1;
        continue;
      }
      const existing = new Map((await deps.db.select({ playbookId: playbookRecords.playbookId, lastDay: playbookRecords.lastDay, days: playbookRecords.days }).from(playbookRecords).where(and(eq(playbookRecords.venue, venue), eq(playbookRecords.asset, asset)))).map((r) => [r.playbookId, `${r.lastDay ?? ""}:${r.days}`] as const));
      const stamp = `${latest}:${days.length}`;
      for (const p of PLAYBOOKS) {
        if (!p.assets.includes(asset)) continue;
        if (existing.get(p.id) === stamp) {
          totals.skipped += 1;
          continue;
        }
        try {
          const record = computePlaybookRecord(p, days, venue, asset, now);
          if (!record) {
            deps.logger.warn({ playbook: p.id }, "playbook template not found; record skipped");
            totals.failed += 1;
            continue;
          }
          await deps.db
            .insert(playbookRecords)
            .values({ playbookId: p.id, venue, asset, computedAt: now, firstDay: record.firstDay, lastDay: record.lastDay, days: days.length, status: record.status, record })
            .onConflictDoUpdate({ target: [playbookRecords.playbookId, playbookRecords.venue, playbookRecords.asset], set: { computedAt: now, firstDay: record.firstDay, lastDay: record.lastDay, days: days.length, status: record.status, record } });
          totals.computed += 1;
          if (record.status === "control-alarm") deps.logger.warn({ playbook: p.id, venue, asset, total: record.stats.total }, "playbook control passed its thresholds: the engine or the data is suspect");
        } catch (e) {
          // one playbook's failure must not stall the rest; the next tick tries it again
          totals.failed += 1;
          deps.logger.warn({ playbook: p.id, venue, asset, err: e instanceof Error ? e.message : String(e) }, "playbook record failed");
        }
      }
    }
  }
  return totals;
}

/** The stored records of a venue, every playbook and asset. */
export async function listPlaybookRecords(db: Db, venue: Venue): Promise<{ playbookId: string; asset: Underlying; record: PlaybookRecord }[]> {
  const rows = await db.select({ playbookId: playbookRecords.playbookId, asset: playbookRecords.asset, record: playbookRecords.record }).from(playbookRecords).where(eq(playbookRecords.venue, venue));
  return rows.map((r) => ({ playbookId: r.playbookId, asset: r.asset, record: r.record }));
}

/** Run the refresh now and every `intervalMs`, never overlapping; returns the stop function. */
export function startPlaybookRecords(deps: PlaybookRecordDeps, venues: readonly Venue[], intervalMs: number): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const totals = await refreshPlaybookRecords(deps, venues);
      if (totals.computed > 0 || totals.failed > 0) deps.logger.info(totals, "playbook records refreshed");
    } catch (e) {
      deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "playbook records refresh failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}

// Playbook records for the mock API (ADR-101): every playbook run through the real engine over the synthetic end-of-day
// chains, projected exactly as the API projects it. With twelve synthetic days every record is "insufficient", which
// is the honest state a fresh install shows.
import { PLAYBOOKS, calendarFor, losingYearsOf, playbookOptions, playbookStatus, playbookTemplate, runBacktest } from "@hapiecoin/pricing";
import { type PlaybookRecords, type Underlying, projectPlaybookRecord } from "@hapiecoin/schema";
import { getVenueCore } from "@hapiecoin/venues/core";
import { mockEodDays } from "./mock-backtest";

const UNITS: Record<Underlying, number> = { BTC: 0.001, ETH: 0.01, XAUT: 0.001 };

export function mockPlaybookRecords(days: number, venue: "delta_india" | "deribit" = "delta_india", now = Date.now()): PlaybookRecords {
  const records: PlaybookRecords["records"] = [];
  for (const asset of ["BTC", "ETH"] as const) {
    const eod = mockEodDays(asset, days, now);
    for (const p of PLAYBOOKS) {
      if (!p.assets.includes(asset)) continue;
      const tpl = playbookTemplate(p);
      if (!tpl) continue;
      const r = runBacktest(tpl, eod, playbookOptions(p, { unitsPerLot: UNITS[asset], calendar: calendarFor(12), fees: getVenueCore(venue).feeRule }));
      records.push({
        playbookId: p.id,
        asset,
        record: projectPlaybookRecord({
          computedAt: new Date(now).toISOString(),
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
          fees: getVenueCore(venue).feeRule ? "venue" : "none",
        }),
      });
    }
  }
  return { venue, records };
}

// Synthetic end-of-day chains for the mock API's backtest (ADR-077): the recorded instrument fixture's ladders on
// each of the last `days` days at the settlement hour, the spot drifting a little, run through the real engine and
// projected exactly as the API projects it (money to cents).
import type { BacktestFees, BacktestResult, Underlying } from "@hapiecoin/schema";
import { toDecimal } from "@hapiecoin/schema";
import { type EodDay, type EodRow, calendarFor, runBacktest, templateByName } from "@hapiecoin/pricing";
import { getVenueCore } from "@hapiecoin/venues/core";
import { SPOT0, buildChain, expiriesOf } from "./fixtures/chain";

const DAY = 86_400_000;
const UNITS: Record<Underlying, number> = { BTC: 0.001, ETH: 0.01, XAUT: 0.001 };

export function mockEodDays(asset: Underlying, days: number, now = Date.now()): EodDay[] {
  const noon = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 12);
  const expiries = expiriesOf()[asset];
  const out: EodDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = noon - i * DAY;
    const spot = SPOT0[asset] * (1 + 0.012 * Math.sin(i / 2));
    const day = new Date(ts).toISOString().slice(0, 10);
    out.push({
      day,
      ts,
      spot,
      expiries: expiries
        .filter((e) => e >= day)
        .map((e) => ({
          expiry: e,
          rows: buildChain(asset, e, ts).map((r): EodRow => ({ strike: Number(r.strike), call: r.call ? { mark: Number(r.call.mark), iv: r.call.markIv } : undefined, put: r.put ? { mark: Number(r.put.mark), iv: r.put.markIv } : undefined })),
        })),
    });
  }
  return out;
}

export interface MockBacktestParams {
  asset: Underlying;
  template: string;
  lots: number;
  minDte: number;
  from?: string | undefined;
  to?: string | undefined;
  days: number;
  venue?: "delta_india" | "deribit" | undefined;
  /** ADR-099 rules, as the API reads them from the query (percent for the exits). */
  fees?: BacktestFees | undefined;
  smaDays?: number | undefined;
  smaSide?: "above" | "below" | undefined;
  ivRankMin?: number | undefined;
  ivRankMax?: number | undefined;
  weekdays?: number[] | undefined;
  targetPct?: number | undefined;
  stopPct?: number | undefined;
  timeStopDte?: number | undefined;
}

export function mockBacktest(p: MockBacktestParams): BacktestResult | null {
  const tpl = templateByName(p.template);
  if (!tpl) return null;
  const days = mockEodDays(p.asset, p.days);
  const fees = (p.fees ?? "venue") === "venue" ? getVenueCore(p.venue ?? "delta_india").feeRule : null;
  const conditions =
    p.smaDays !== undefined || p.ivRankMin !== undefined || p.ivRankMax !== undefined || p.weekdays !== undefined
      ? {
          sma: p.smaDays !== undefined && p.smaSide ? { days: p.smaDays, side: p.smaSide } : undefined,
          ivRank: p.ivRankMin !== undefined || p.ivRankMax !== undefined ? { min: p.ivRankMin, max: p.ivRankMax, lookbackDays: 365 } : undefined,
          weekdays: p.weekdays,
        }
      : undefined;
  const exits =
    p.targetPct !== undefined || p.stopPct !== undefined || p.timeStopDte !== undefined
      ? { targetPct: p.targetPct === undefined ? undefined : p.targetPct / 100, stopPct: p.stopPct === undefined ? undefined : p.stopPct / 100, timeStopDte: p.timeStopDte }
      : undefined;
  const r = runBacktest(tpl, days, { lots: p.lots, unitsPerLot: UNITS[p.asset], minDte: p.minDte, calendar: calendarFor(p.asset === "XAUT" ? 16 : 12), from: p.from, to: p.to, fees, conditions, exits });
  const money = (n: number) => toDecimal(n, 2);
  const opt = (n: number | null) => (n === null ? null : money(n));
  return {
    asset: p.asset,
    venue: p.venue ?? "delta_india",
    template: tpl.name,
    lots: p.lots,
    minDte: p.minDte,
    trades: r.trades.map((t) => ({
      entryDay: t.entryDay,
      exitDay: t.exitDay,
      expiry: t.expiry,
      legs: t.legs.map((l) => ({ kind: l.kind, side: l.side, strike: toDecimal(l.strike, 8), expiry: l.expiry, price: toDecimal(l.price, 8), quantity: toDecimal(l.quantity, 6), exitPrice: toDecimal(l.exitPrice, 8) })),
      entryCost: money(t.entryCost),
      grossPnl: money(t.grossPnl),
      fees: money(t.fees),
      pnl: money(t.pnl),
      exitReason: t.exitReason,
      ruleInert: t.ruleInert,
      status: t.status,
      modelled: t.modelled,
      daysHeld: t.daysHeld,
    })),
    equity: r.equity.map((e) => ({ day: e.day, pnl: money(e.pnl) })),
    stats: { ...r.stats, total: money(r.stats.total), grossTotal: money(r.stats.grossTotal), totalFees: money(r.stats.totalFees), average: opt(r.stats.average), median: opt(r.stats.median), best: opt(r.stats.best), worst: opt(r.stats.worst), maxDrawdown: money(r.stats.maxDrawdown) },
    coverage: r.coverage,
    fees: p.fees ?? "venue",
  };
}

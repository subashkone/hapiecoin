/**
 * Strategy backtest (ADR-077; HC-TR-184): a catalogue template entered at every recorded end of day over the venue's
 * chain history and held to expiry, computed by the pricing package's `runBacktest` over `chain_eod`. Behind the
 * session (every plan, GAPS #93), cached five minutes; 503 while no day has been recorded for the underlying.
 * ADR-099 (HC-TR-200..202): the venue's published fee rule is charged by default (fees=none turns it off; a venue
 * without a rule refuses fees=venue), and the query may carry entry conditions and exit rules in percent.
 * ADR-100 (HC-TR-203, HC-TR-204): `folds` splits the range into walk-forward periods, and GET /v1/backtest/sweep runs
 * one or two rule parameters over a grid capped at 48 trials, every trial with its plateau reading.
 */
import { BacktestQuery, BacktestResult, SweepQuery, SweepResult, parseSweepValues, toDecimal } from "@hapiecoin/schema";
import { type BacktestOptions, type BacktestResult as EngineResult, type SweepAxisSpec, type SweepResult as EngineSweep, calendarFor, runBacktest, sweepBacktest, sweepShape, templateByName } from "@hapiecoin/pricing";
import { type VenueAdapter } from "@hapiecoin/venues";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { eodDaysCached } from "../chain-eod.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

/** Money to cents, sizes to six places, prices as the venue quotes them. */
const money = (n: number) => toDecimal(n, 2);
const opt = (n: number | null) => (n === null ? null : money(n));
const statsOut = (s: EngineResult["stats"]): BacktestResult["stats"] => ({
  trades: s.trades,
  wins: s.wins,
  losses: s.losses,
  winRate: s.winRate,
  total: money(s.total),
  grossTotal: money(s.grossTotal),
  totalFees: money(s.totalFees),
  average: opt(s.average),
  median: opt(s.median),
  best: opt(s.best),
  worst: opt(s.worst),
  maxDrawdown: money(s.maxDrawdown),
  profitFactor: s.profitFactor,
});

export function toApiResult(r: EngineResult, meta: { asset: BacktestResult["asset"]; venue: BacktestResult["venue"]; template: string; lots: number; minDte: number; fees: BacktestResult["fees"] }): BacktestResult {
  return {
    ...meta,
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
    stats: statsOut(r.stats),
    coverage: r.coverage,
    ...(r.folds ? { folds: r.folds.map((f) => ({ index: f.index, firstDay: f.firstDay, lastDay: f.lastDay, entries: f.entries, stats: statsOut(f.stats) })) } : {}),
  };
}

export function toApiSweep(r: EngineSweep, meta: { asset: SweepResult["asset"]; venue: SweepResult["venue"]; template: string; lots: number; fees: SweepResult["fees"] }): SweepResult {
  return {
    ...meta,
    axes: r.axes.map((a) => ({ axis: a.axis, values: [...a.values] })),
    trials: r.trials.map((t) => ({ values: t.values, trades: t.trades, total: money(t.total), grossTotal: money(t.grossTotal), totalFees: money(t.totalFees), winRate: t.winRate, maxDrawdown: money(t.maxDrawdown), profitFactor: t.profitFactor, plateau: t.plateau })),
    best: r.best,
    cap: r.cap,
  };
}

/**
 * The engine options a query asks for, validated (400s) before any data is read: the venue's fee rule or none, the
 * entry conditions (smaDays and smaSide together, ivRankMin at most ivRankMax) and the exit rules in percent.
 */
export function optionsFromQuery(q: Omit<BacktestQuery, "folds"> & { folds?: number | undefined }, venue: string, adapter: VenueAdapter, unitsPerLot: number): BacktestOptions {
  if (q.from && q.to && q.from > q.to) throw errors.badRequest("from must not be after to");
  // ADR-099: the venue's published rule, or nothing; a venue whose schedule was never read cannot be charged
  const fees = q.fees === "venue" ? adapter.feeRule : null;
  if (q.fees === "venue" && fees === null) throw errors.badRequest(`${venue} publishes no fee rule here; run with fees=none`);
  if ((q.smaDays === undefined) !== (q.smaSide === undefined)) throw errors.badRequest("smaDays and smaSide go together");
  if (q.ivRankMin !== undefined && q.ivRankMax !== undefined && q.ivRankMin > q.ivRankMax) throw errors.badRequest("ivRankMin must not exceed ivRankMax");
  const wantsConditions = q.smaDays !== undefined || q.ivRankMin !== undefined || q.ivRankMax !== undefined || q.weekdays !== undefined;
  const conditions = wantsConditions
    ? {
        sma: q.smaDays !== undefined && q.smaSide !== undefined ? { days: q.smaDays, side: q.smaSide } : undefined,
        ivRank: q.ivRankMin !== undefined || q.ivRankMax !== undefined ? { min: q.ivRankMin, max: q.ivRankMax, lookbackDays: 365 } : undefined,
        weekdays: q.weekdays === undefined ? undefined : q.weekdays.split(",").map(Number),
      }
    : undefined;
  const exits =
    q.targetPct !== undefined || q.stopPct !== undefined || q.timeStopDte !== undefined
      ? { targetPct: q.targetPct === undefined ? undefined : q.targetPct / 100, stopPct: q.stopPct === undefined ? undefined : q.stopPct / 100, timeStopDte: q.timeStopDte }
      : undefined;
  return { lots: q.lots, unitsPerLot, minDte: q.minDte, calendar: calendarFor(adapter.calendar.settlementHourUtc(q.asset)), from: q.from, to: q.to, fees, conditions, exits, folds: q.folds };
}

export function registerBacktestRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/backtest",
      tags: ["backtest"],
      summary: "A template entered at every recorded end of day over the venue's chain history, net of its fee rule, with optional entry conditions and exit rules (HC-TR-184, HC-TR-200..202)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: BacktestQuery },
      responses: { 200: jsonContent(BacktestResult, "Backtest"), 400: errorResponses[400], 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const tpl = templateByName(q.template);
      if (!tpl) throw errors.badRequest(`Unknown template "${q.template}"`);
      const venue = q.venue ?? DEFAULT_VENUE;
      const adapter = getVenue(venue);
      const options = optionsFromQuery(q, venue, adapter, Number(defaultLotSizes(adapter)[q.asset]));
      // the whole recorded history: the engine bounds the entries and the coverage by `from` / `to` and keeps the
      // earlier days as history for the conditions (ADR-099); a trade entered inside the range still settles after it
      const days = await eodDaysCached(deps.db, venue, q.asset);
      if (days.length === 0) throw errors.unavailable(`no end-of-day chains recorded for ${q.asset} on ${venue} yet; the first one lands once the venue's chain is being recorded, at the settlement hour`);
      const result = runBacktest(tpl, days, options);
      c.header("Cache-Control", "private, max-age=300");
      return c.json(toApiResult(result, { asset: q.asset, venue, template: tpl.name, lots: q.lots, minDte: q.minDte, fees: q.fees }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/backtest/sweep",
      tags: ["backtest"],
      summary: "One or two rule parameters run over a grid of at most 48 trials, each trial with its net result and plateau reading (HC-TR-204)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: SweepQuery },
      responses: { 200: jsonContent(SweepResult, "Sweep"), 400: errorResponses[400], 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const tpl = templateByName(q.template);
      if (!tpl) throw errors.badRequest(`Unknown template "${q.template}"`);
      const venue = q.venue ?? DEFAULT_VENUE;
      const adapter = getVenue(venue);
      const options = optionsFromQuery(q, venue, adapter, Number(defaultLotSizes(adapter)[q.asset]));
      if ((q.axis2 === undefined) !== (q.values2 === undefined)) throw errors.badRequest("axis2 and values2 go together");
      // every value obeys the same bounds as the single run's field (an average of 2.5 days or a negative DTE never reaches the engine) and the list increases
      const values1 = parseSweepValues(q.axis1, q.values1);
      if (values1 === null) throw errors.badRequest(`values1 must be increasing values ${q.axis1} accepts`);
      const axes: SweepAxisSpec[] = [{ axis: q.axis1, values: values1 }];
      if (q.axis2 !== undefined && q.values2 !== undefined) {
        const values2 = parseSweepValues(q.axis2, q.values2);
        if (values2 === null) throw errors.badRequest(`values2 must be increasing values ${q.axis2} accepts`);
        axes.push({ axis: q.axis2, values: values2 });
      }
      try {
        sweepShape(axes); // the cap and the shape rules, before any data is read
      } catch (e) {
        throw errors.badRequest(e instanceof Error ? e.message : String(e));
      }
      const days = await eodDaysCached(deps.db, venue, q.asset);
      if (days.length === 0) throw errors.unavailable(`no end-of-day chains recorded for ${q.asset} on ${venue} yet; the first one lands once the venue's chain is being recorded, at the settlement hour`);
      const result = sweepBacktest(tpl, days, options, axes);
      c.header("Cache-Control", "private, max-age=300");
      return c.json(toApiSweep(result, { asset: q.asset, venue, template: tpl.name, lots: q.lots, fees: q.fees }), 200);
    },
  );
}

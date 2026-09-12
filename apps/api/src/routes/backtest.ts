/**
 * Strategy backtest (ADR-077; HC-TR-184): a catalogue template entered at every recorded end of day over the venue's
 * chain history and held to expiry, computed by the pricing package's `runBacktest` over `chain_eod`. Behind the
 * session (every plan, GAPS #93), cached five minutes; 503 while no day has been recorded for the underlying.
 */
import { BacktestQuery, BacktestResult, toDecimal } from "@hapiecoin/schema";
import { type BacktestResult as EngineResult, calendarFor, runBacktest, templateByName } from "@hapiecoin/pricing";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { eodDaysCached } from "../chain-eod.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

/** Money to cents, sizes to six places, prices as the venue quotes them. */
export function toApiResult(r: EngineResult, meta: { asset: BacktestResult["asset"]; venue: BacktestResult["venue"]; template: string; lots: number; minDte: number }): BacktestResult {
  const money = (n: number) => toDecimal(n, 2);
  const opt = (n: number | null) => (n === null ? null : money(n));
  return {
    ...meta,
    trades: r.trades.map((t) => ({
      entryDay: t.entryDay,
      exitDay: t.exitDay,
      expiry: t.expiry,
      legs: t.legs.map((l) => ({ kind: l.kind, side: l.side, strike: toDecimal(l.strike, 8), expiry: l.expiry, price: toDecimal(l.price, 8), quantity: toDecimal(l.quantity, 6), exitPrice: toDecimal(l.exitPrice, 8) })),
      entryCost: money(t.entryCost),
      pnl: money(t.pnl),
      status: t.status,
      modelled: t.modelled,
      daysHeld: t.daysHeld,
    })),
    equity: r.equity.map((e) => ({ day: e.day, pnl: money(e.pnl) })),
    stats: {
      trades: r.stats.trades,
      wins: r.stats.wins,
      losses: r.stats.losses,
      winRate: r.stats.winRate,
      total: money(r.stats.total),
      average: opt(r.stats.average),
      median: opt(r.stats.median),
      best: opt(r.stats.best),
      worst: opt(r.stats.worst),
      maxDrawdown: money(r.stats.maxDrawdown),
      profitFactor: r.stats.profitFactor,
    },
    coverage: r.coverage,
  };
}

export function registerBacktestRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/backtest",
      tags: ["backtest"],
      summary: "A template entered at every recorded end of day and held to expiry, over the venue's chain history (HC-TR-184)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: BacktestQuery },
      responses: { 200: jsonContent(BacktestResult, "Backtest"), 400: errorResponses[400], 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const tpl = templateByName(q.template);
      if (!tpl) throw errors.badRequest(`Unknown template "${q.template}"`);
      if (q.from && q.to && q.from > q.to) throw errors.badRequest("from must not be after to");
      const venue = q.venue ?? DEFAULT_VENUE;
      const adapter = getVenue(venue);
      // every recorded day from `from` on: `to` bounds the entries, and a trade entered inside the range still settles after it
      const days = (await eodDaysCached(deps.db, venue, q.asset)).filter((d) => !q.from || d.day >= q.from);
      if (days.length === 0) throw errors.unavailable(`no end-of-day chains recorded for ${q.asset} on ${venue} yet; the first one lands once the venue's chain is being recorded, at the settlement hour`);
      const unitsPerLot = Number(defaultLotSizes(adapter)[q.asset]);
      const result = runBacktest(tpl, days, { lots: q.lots, unitsPerLot, minDte: q.minDte, calendar: calendarFor(adapter.calendar.settlementHourUtc(q.asset)), from: q.from, to: q.to });
      c.header("Cache-Control", "private, max-age=300");
      return c.json(toApiResult(result, { asset: q.asset, venue, template: tpl.name, lots: q.lots, minDte: q.minDte }), 200);
    },
  );
}

// The replay against the engine it replays (ADR-144; HC-TR-286; GAPS #180 a). Three saved strategies are entered on
// paper by Autopilot itself; each trade is then walked through one price path twice: by the rules engine and the
// settler on the rows the entry wrote, and by `simulateTrade` on the same legs and marks. The two must book the same
// closes, the same total and the same reason. Nothing here places anything on a venue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlaybookProposal } from "@hapiecoin/pricing";
import { type Instrument, type Quote, SavedDefinition, type SavedStrategy } from "@hapiecoin/schema";
import { getVenue } from "@hapiecoin/venues";
import { asc, eq } from "drizzle-orm";
import { clockPlanFor, runAutopilot } from "./autopilot.js";
import { savedPlaybook } from "./autopilot-saved.js";
import { type SimBar, type SimLeg, simulateTrade } from "./clock-sim.js";
import { strategies, strategyLegs } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type MarketSource, snapshotOnce } from "./iv-snapshot.js";
import { evaluateRules } from "./rules-engine.js";
import { settleExpired } from "./settlement.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let admin: string;
let trader: { cookie: string; id: string };
const BASE = "/v1/admin/autopilot-strategies";
const MIN = 60_000;
const SPOT = 83_200;
/** 21:35 IST on 25 Sep 2026: inside the evening window; the next expiry settles at 12:00 UTC on the 26th. */
const W = Date.UTC(2026, 8, 25, 16, 5, 0);
const SETTLE = Date.UTC(2026, 8, 26, 12, 0, 0);
const UNITS = 0.001;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  const a = await t.signUp("sim-parity@hapiecoin.test");
  trader = { cookie: a.cookie, id: (await json<{ id: string }>(await t.request("/v1/me", { cookie: a.cookie }))).id };
});
afterAll(() => t.close());

/** A chain around 83,200 on a 200 grid whose time value falls away from the money. */
function chainAt(ts: number): MarketSource {
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of ["2026-09-25", "2026-09-26"])
    for (let i = -14; i <= 14; i++) {
      const k = SPOT + i * 200;
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const tv = 400 * Math.exp(-Math.abs(k - SPOT) / 1500);
      for (const [kind, symbol, mark] of [["call", `C-BTC-${k}-${code}`, Math.max(SPOT - k, 0) + tv], ["put", `P-BTC-${k}-${code}`, Math.max(k - SPOT, 0) + tv]] as const) {
        products.push({ id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(k), expiry: e, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true });
        quotes.push({ instrumentId: `delta_india:${symbol}`, ts, mark: mark.toFixed(1), oi: "1", spot: String(SPOT), markIv: 0.4 });
      }
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const strangle = (pct: number, exits: object) => ({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: pct }, { kind: "call", side: "sell", by: "pct", value: pct }], exits });
async function publish(name: string, definition: object): Promise<SavedStrategy> {
  const made = await json<SavedStrategy>(await t.request(BASE, { cookie: admin, method: "POST", json: { name, summary: "Sell both sides each evening.", definition } }));
  await t.request(`${BASE}/${made.id}`, { cookie: admin, method: "PATCH", json: { backtest: { mean: 1, per: "day", positivePct: 50, worst: -1, samples: 1, basis: "a test" }, audience: "plans", planIds: [SEED.plans.elite] } });
  expect((await json<SavedStrategy>(await t.request(`${BASE}/${made.id}/publish`, { cookie: admin, method: "POST" }))).stage).toBe("paper");
  return made;
}

interface Entered {
  id: string;
  entryMs: number;
  legs: (SimLeg & { symbol: string })[];
  definition: SavedDefinition;
}
/** The trade Autopilot made of a saved strategy: its legs in the order of the structure, put first. */
async function entered(saved: SavedStrategy): Promise<Entered> {
  const [trade] = await t.db.select().from(strategies).where(eq(strategies.autopilotPlaybookId, saved.id));
  const rows = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
  return { id: trade!.id, entryMs: trade!.startedAt!.getTime(), definition: SavedDefinition.parse(saved.definition), legs: rows.map((l) => ({ kind: l.kind as "call" | "put", side: l.side, strike: Number(l.strike), lots: l.lots, price: Number(l.entryPrice), symbol: l.symbol })) };
}
/** The plan the engine made at the entry, from the same function and the same legs. */
function planOf(e: Entered) {
  const p = savedPlaybook({ id: "sv_x", name: "X", summary: "s", definition: e.definition, backtest: null });
  const entryCost = e.legs.reduce((sum, l) => sum + (l.side === "buy" ? 1 : -1) * l.price * l.lots * UNITS, 0);
  const proposal = { day: "2026-09-25", spot: SPOT, expiry: "2026-09-26", legs: e.legs.map((l) => ({ ...l, price: String(l.price) })), entryCost, maxProfit: 0, maxLoss: 0 } as unknown as PlaybookProposal;
  return clockPlanFor(p, proposal, UNITS, getVenue("delta_india").feeRule)!;
}
/** The same path through the live rules: one tick a bar, and again on that bar until nothing fires, as two-second ticks would. */
async function live(e: Entered, bars: readonly SimBar[]): Promise<void> {
  for (const bar of bars)
    for (let again = 0; again < 8; again++) {
      const marks = new Map(e.legs.flatMap((l, i) => (bar.marks[i] === null || bar.marks[i] === undefined ? [] : [[l.symbol, bar.marks[i]] as [string, number]])));
      const report = await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks, spot: null }) }, () => bar.ts);
      if (report.fired.length === 0) break;
    }
}
const bookOf = async (id: string) => {
  const [s] = await t.db.select().from(strategies).where(eq(strategies.id, id));
  return { total: Number(s!.realizedPnl), status: s!.status, reason: s!.closeReason, closedMs: s!.closedAt?.getTime() ?? null };
};
const replay = (e: Entered, bars: readonly SimBar[], settleSpot = SPOT) => simulateTrade({ legs: e.legs, plan: planOf(e), unitsPerLot: UNITS, feeRule: null, entryMs: e.entryMs, entrySpot: SPOT, settleMs: SETTLE, settleSpot, bars });

describe("HC-TR-286 the replay books what the engine books", () => {
  let stopTrail: Entered;
  let takeBack: Entered;
  let steps: Entered;

  it("HC-TR-286 three saved strategies are entered on paper by Autopilot, on strikes of their own", async () => {
    const a = await publish("Parity stop and trail", strangle(1, { legStop: 2, trailRestPct: 50 }));
    const b = await publish("Parity take and buy-back", strangle(2, { takeProfitOfCredit: 0.5, legBuyBackAt: 5 }));
    const c = await publish("Parity steps and share", strangle(3, { ladder: [25, 50], legBuyBackShare: 0.2 }));
    await t.request("/v1/autopilot", { cookie: trader.cookie, method: "PUT", json: { enabled: true, strategies: [a, b, c].map((s) => ({ playbookId: s.id, exit: "own" })) } });
    await snapshotOnce(t.deps, chainAt(W - MIN), () => W - MIN);
    expect(await runAutopilot({ db: t.db, logger: t.deps.logger, now: () => W }, ["delta_india"])).toMatchObject({ entered: 3, failed: 0 });
    [stopTrail, takeBack, steps] = [await entered(a), await entered(b), await entered(c)];
    const symbols = [stopTrail, takeBack, steps].flatMap((e) => e.legs.map((l) => l.symbol));
    expect(new Set(symbols).size).toBe(6);
    expect([stopTrail, takeBack, steps].every((e) => e.legs.map((l) => `${l.side}:${l.kind}`).join() === "sell:put,sell:call" && e.legs.every((l) => l.price > 50))).toBe(true);
  });

  it("HC-TR-286 a stop on one sold option, then the trail on the rest: the same closes, total and reason", async () => {
    const [p, c] = [stopTrail.legs[0]!.price, stopTrail.legs[1]!.price];
    const at = (n: number, put: number, call: number): SimBar => ({ ts: stopTrail.entryMs + n * 5 * MIN, marks: [put, call], spot: null });
    // the call past twice its price (a mark with a third decimal), the put 2.00 up, 4.00 at its best, then back under 2.00
    const bars = [at(1, p - 20.004, 2 * c + 1.006), at(2, p - 40, 3 * c), at(3, p - 21, 3 * c), at(4, p - 19.5, 3 * c), at(5, 1, 1)];
    const sim = replay(stopTrail, bars);
    expect(sim.events.map((e) => [e.kind, e.ts])).toEqual([["leg_stop", bars[0]!.ts], ["trail", bars[3]!.ts]]);
    await live(stopTrail, bars);
    const book = await bookOf(stopTrail.id);
    expect(book).toEqual({ total: expect.closeTo(sim.gross, 6) as number, status: "archived", reason: sim.reason, closedMs: sim.closedMs });
    expect(book.reason).toBe("stopped");
    const rows = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, stopTrail.id)).orderBy(asc(strategyLegs.position));
    expect(rows.map((l) => Number(l.exitPrice))).toEqual([sim.events[1]!.closed[0]!.price, sim.events[0]!.closed[0]!.price]);
  });

  it("HC-TR-286 a buy-back booked in cents and a profit take judged on that total: the bar a half-cent short does not fire in either", async () => {
    const [p, c] = [takeBack.legs[0]!.price, takeBack.legs[1]!.price];
    const target = Number(planOf(takeBack).targetUsd!.toFixed(2));
    // the put bought back at 4.97; then a call mark that puts the unrounded total a tenth of a cent over the target
    const raw = (p - 4.97) * 100 * UNITS;
    const short = Number((c - (target - raw + 0.001) / (100 * UNITS)).toFixed(2));
    const at = (n: number, put: number, call: number): SimBar => ({ ts: takeBack.entryMs + n * 5 * MIN, marks: [put, call], spot: null });
    const bars = [at(1, 4.97, c + 30), at(2, 4.97, short), at(3, 4.97, short - 5)];
    // the case is the one meant: unrounded the total is over the level, in the book it is under
    expect(raw + (c - short) * 100 * UNITS).toBeGreaterThanOrEqual(target);
    expect(Number(raw.toFixed(2)) + (c - short) * 100 * UNITS).toBeLessThan(target);
    const sim = replay(takeBack, bars);
    expect(sim.events.map((e) => [e.kind, e.ts])).toEqual([["leg_take", bars[0]!.ts], ["target", bars[2]!.ts]]);
    await live(takeBack, bars.slice(0, 2));
    expect((await bookOf(takeBack.id)).status).toBe("paper"); // the call is still held after the bar a half-cent short
    await live(takeBack, bars.slice(2));
    expect(await bookOf(takeBack.id)).toEqual({ total: expect.closeTo(sim.gross, 6) as number, status: "archived", reason: sim.reason, closedMs: sim.closedMs });
  });

  it("HC-TR-286 profit in steps, a buy-back by share, and the rest settled in the money by the settler: the same total and reason", async () => {
    const [p, c] = [steps.legs[0]!.price, steps.legs[1]!.price];
    const at = (n: number, put: number, call: number): SimBar => ({ ts: steps.entryMs + n * 5 * MIN, marks: [put, call], spot: null });
    // a quarter of the premium, then half; then the put down to a fifth of its price while the call stays
    const bars = [at(1, 0.75 * p, 0.75 * c), at(2, 0.5 * p, 0.5 * c), at(3, 0.19 * p, 0.5 * c), at(4, 0.19 * p, 0.6 * c)];
    const settleSpot = steps.legs[1]!.strike + 100.004;
    const sim = replay(steps, bars, settleSpot);
    expect(sim.events.map((e) => [e.kind, e.closed.map((x) => x.lots)])).toEqual([["step", [33, 33]], ["step", [34, 34]], ["leg_take", [33]], ["settled", [33]]]);
    await live(steps, bars);
    expect((await bookOf(steps.id)).status).toBe("paper");
    // (the settler waits a while after the instant before it books)
    await settleExpired(t.deps, { spotAt: () => Promise.resolve(settleSpot) }, () => SETTLE + 60 * MIN);
    const book = await bookOf(steps.id);
    expect(book.total).toBeCloseTo(sim.gross, 6);
    expect([book.status, book.reason]).toEqual(["archived", sim.reason]);
    expect(sim.reason).toBe("expired");
  });
});

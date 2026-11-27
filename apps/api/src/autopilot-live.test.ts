// Autopilot's live entry (ADR-148; HC-TR-299..306): off unless the server switch hands it to the engine; then, for a
// trader with an active mandate, the gate, the orders (buys first, stop at the first leg that does not fill), the exits
// armed only on a complete entry, and the mandate paused on an incomplete one. Every order here goes to the FAKE venue.
import { type Instrument, MANDATE_REFUSALS, type Quote, type SavedStrategy } from "@hapiecoin/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AutopilotDeps, runAutopilot } from "./autopilot.js";
import { LIVE_ENTRY_GRACE_MS, hasIncompleteEntry, liveEntryHook, liveOrderKey, lossWindows, sweepIncompleteLive } from "./autopilot-live.js";
import { stepMandate } from "./autopilot-mandate.js";
import { evaluateRules } from "./rules-engine.js";
import { autopilotLiveOf, loadConfig } from "./config.js";
import { auditLog, autopilotMandates, autopilotRuns, autopilotSavedStrategies, brokerCredentials, strategies, strategyLegs, strategyOrders, strategyRules, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type MarketSource, snapshotOnce } from "./iv-snapshot.js";
import type { MarginParams } from "./margin.js";
import { paperRecordOf } from "./saved-approval.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let admin: string;
const ADMIN = "/v1/admin/autopilot-strategies";
const MIN = 60_000;
const DAY = 86_400_000;
const SPOT = 83_200;
const EXPIRY = "2026-09-26";
const CODE = "260926";
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const idOf = async (cookie: string) => (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;
/** 21:35 IST on 25 Sep 2026: inside the evening window. A Friday. */
const W = Date.UTC(2026, 8, 25, 16, 5, 0);

const strikes = Array.from({ length: 25 }, (_, i) => SPOT + (i - 12) * 200);
const markOf = (kind: "call" | "put", k: number) => ((kind === "call" ? Math.max(SPOT - k, 0) : Math.max(k - SPOT, 0)) + 400 * Math.exp(-Math.abs(k - SPOT) / 1500)).toFixed(1);
const symbolOf = (kind: "call" | "put", k: number) => `${kind === "call" ? "C" : "P"}-BTC-${k}-${CODE}`;
const productId = (kind: "call" | "put", k: number) => (kind === "call" ? 100_000 : 200_000) + k;
function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** The snapshot the engine prices on: a chain around 83,200 whose time value falls away from the money. */
function curveAt(ts: number): MarketSource {
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const k of strikes)
    for (const kind of ["call", "put"] as const) {
      const s = symbolOf(kind, k);
      products.push(inst(s, kind, k, EXPIRY));
      quotes.push({ instrumentId: `delta_india:${s}`, ts, mark: markOf(kind, k), oi: "1", spot: String(SPOT), markIv: 0.4 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const PARAMS: MarginParams = { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: "200000" };
const marginInputs = (_a: string, _v: string, spot?: number) => Promise.resolve({ spot: spot ?? SPOT, params: new Map(strikes.flatMap((k) => (["call", "put"] as const).map((kind) => [symbolOf(kind, k), PARAMS] as const))) });
/** The fake exchange quotes the same chain, with margin parameters, and fills at its mark. */
function resetVenue(): void {
  for (const k of strikes)
    for (const kind of ["call", "put"] as const) {
      const id = productId(kind, k);
      t.trading.product(symbolOf(kind, k), id, "0.001", "live", "0.1", { pct: "0.5", factor: "0.000002", threshold: "200000" }).markAt(symbolOf(kind, k), markOf(kind, k), String(SPOT)).fillAt(id, markOf(kind, k)).succeed(id);
    }
  t.trading.setBalances([{ asset: "USD", balance: "10000", availableBalance: "10000" }]);
}

const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "pct" as const, value });
/** A strangle 1 % away with wings 3 % away: every sold option is covered. Stop a sold option at double, take half the premium. */
const WINGED = { assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [leg("put", "buy", 3), leg("put", "sell", 1), leg("call", "sell", 1), leg("call", "buy", 3)], exits: { legStop: 2, takeProfitOfCredit: 0.5 } };
const FIGURES = { mean: 4.2, per: "day", positivePct: 71, worst: -60, samples: 106, basis: "autopilot-study, real fees" };

type Trader = { cookie: string; id: string; accountId: string };
let n = 0;
/** A trader with Autopilot on and one exchange account of their own. */
async function trader(): Promise<Trader> {
  n += 1;
  const { cookie } = await t.signUp(`live-${n}@hapiecoin.test`);
  const id = await idOf(cookie);
  t.delta.accept(`live-key-${n}`);
  expect((await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, apiKey: `live-key-${n}`, apiSecret: "s3cret" } })).status).toBe(201);
  const [account] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(eq(brokerCredentials.userId, id));
  return { cookie, id, accountId: account!.id };
}
/** A strategy on paper for `who`, approved for live (the approval written straight onto the row: earning one is HC-TR-292's subject), and switched on by them. */
async function strategy(who: Trader, name: string): Promise<SavedStrategy> {
  const made = await json<SavedStrategy>(await t.request(ADMIN, { cookie: admin, method: "POST", json: { name, summary: "Sell both sides each evening, with wings.", definition: WINGED } }));
  expect((await t.request(`${ADMIN}/${made.id}`, { cookie: admin, method: "PATCH", json: { backtest: FIGURES, audience: "users", userIds: [who.id] } })).status).toBe(200);
  expect((await t.request(`${ADMIN}/${made.id}/publish`, { cookie: admin, method: "POST" })).status).toBe(200);
  await approve(made.id);
  expect((await t.request("/v1/autopilot", { cookie: who.cookie, method: "PUT", json: { enabled: true, strategies: [{ playbookId: made.id, exit: "own" }] } })).status).toBe(200);
  return made;
}
async function approve(id: string): Promise<void> {
  const [row] = await t.db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id));
  const { record } = await paperRecordOf(t.db, { id, publishedAt: row!.publishedAt!.toISOString() }, new Date());
  await t.db.update(autopilotSavedStrategies).set({ approval: { by: null, byName: "The Owner", at: new Date().toISOString(), record, backtest: row!.backtest! } }).where(eq(autopilotSavedStrategies.id, id));
}
/** The mandate as a signing would store it (signing is HC-TR-296's subject): 10 lots a trade, 500 USD, 50 a day, 150 a week, one trade open. */
async function mandate(who: Trader, s: SavedStrategy, over: Partial<typeof autopilotMandates.$inferInsert> = {}): Promise<string> {
  const id = `mnd_live_${++n}`;
  await t.db.insert(autopilotMandates).values({ id, userId: who.id, strategyId: s.id, accountId: who.accountId, lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, statements: {}, state: "active", signedAt: new Date(W - DAY), ...over });
  return id;
}
const deps = (nowMs: number, live: boolean): AutopilotDeps => ({ db: t.db, logger: t.deps.logger, now: () => nowMs, marginInputs, ...(live ? { live: liveEntryHook(t.deps) } : {}) });
const pass = async (live: boolean, at = W) => {
  await snapshotOnce(t.deps, curveAt(at - MIN), () => at - MIN);
  return runAutopilot(deps(at, live), ["delta_india"]);
};
const tradesOf = (who: Trader, s: SavedStrategy) => t.db.select().from(strategies).where(and(eq(strategies.userId, who.id), eq(strategies.autopilotPlaybookId, s.id))).orderBy(asc(strategies.createdAt));
const linesOf = (who: Trader, s: SavedStrategy) => t.db.select().from(autopilotRuns).where(and(eq(autopilotRuns.userId, who.id), eq(autopilotRuns.playbookId, s.id))).orderBy(asc(autopilotRuns.id));
const mandateOf = async (id: string) => (await t.db.select().from(autopilotMandates).where(eq(autopilotMandates.id, id)))[0]!;
/** A trader, an approved strategy switched on, and an active mandate for it. */
async function ready(name: string, over: Partial<typeof autopilotMandates.$inferInsert> = {}) {
  const who = await trader();
  const s = await strategy(who, name);
  const mandateId = await mandate(who, s, over);
  return { who, s, mandateId };
}

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
});
afterAll(() => t.close());
beforeEach(async () => {
  resetVenue();
  // each test starts with Autopilot off for everyone but its own trader: no other test's strategy is entered in its pass
  await t.db.update(autopilotMandates).set({ state: "ended" });
  const { autopilotSettings } = await import("./db/schema.js");
  await t.db.update(autopilotSettings).set({ enabled: false });
});

describe("HC-TR-299 live Autopilot is off unless the server switch hands it to the engine", () => {
  it("HC-TR-299 the switch is off by default and allows only the exchange's named testnet host: the real exchange, a proxy, an IP, a look-alike name and plain http are each refused at startup", () => {
    expect(t.config.autopilotLive).toBe(false);
    const TESTNET = "https://cdn-ind.testnet.deltaex.org";
    for (const url of [TESTNET, "https://api.india.delta.exchange", "nonsense"]) expect(autopilotLiveOf("off", url)).toBe(false);
    expect(autopilotLiveOf("testnet", TESTNET)).toBe(true);
    expect(autopilotLiveOf("testnet", `${TESTNET}/`)).toBe(true);
    // every host that is not the named one: the label of ADR-092 would call most of these "testnet"
    for (const url of ["https://api.india.delta.exchange", "https://api.india.delta.exchange./", "https://api.delta.exchange", "https://proxy.internal.example", "https://203.0.113.7", "https://cdn-ind.testnet.deltaex.org.evil.example", "https://testnet.example.test", "http://cdn-ind.testnet.deltaex.org", "https://cdn-ind.testnet.deltaex.org:8443", "not a url", ""])
      expect(() => autopilotLiveOf("testnet", url), url).toThrowError(/not one of the named testnet hosts/);
    // the test harness's local mock, and only under NODE_ENV=test
    expect(autopilotLiveOf("testnet", "http://127.0.0.1:3101", true)).toBe(true);
    expect(() => autopilotLiveOf("testnet", "http://127.0.0.1:3101")).toThrowError(/named testnet hosts/);
    expect(() => autopilotLiveOf("testnet", "https://proxy.internal.example", true)).toThrowError(/named testnet hosts/);
    const env = (over: Record<string, string>) => ({ ...process.env, ...over }) as Record<string, string>;
    expect(loadConfig(env({ AUTOPILOT_LIVE: "testnet", DELTA_TRADING_REST_URL: TESTNET }), { warn: () => undefined }).autopilotLive).toBe(true);
    expect(() => loadConfig(env({ AUTOPILOT_LIVE: "testnet", DELTA_TRADING_REST_URL: "https://api.india.delta.exchange" }), { warn: () => undefined })).toThrowError(/named testnet hosts/);
    expect(() => loadConfig(env({ AUTOPILOT_LIVE: "testnet", NODE_ENV: "production", DELTA_TRADING_REST_URL: "http://127.0.0.1:3101" }), { warn: () => undefined })).toThrowError();
    expect(() => loadConfig(env({ AUTOPILOT_LIVE: "production" }), { warn: () => undefined })).toThrowError();
  });

  it("HC-TR-299 with the switch off a trader who holds an active mandate is entered on paper as always: no order, no live row", async () => {
    const { who, s } = await ready("Switch off");
    const sent = t.trading.placed.length;
    expect(await pass(false)).toMatchObject({ entered: 1, failed: 0 });
    const [trade] = await tradesOf(who, s);
    expect(trade).toMatchObject({ status: "paper", tradingMode: "paper", accountId: null, autopilotMandateId: null });
    expect(t.trading.placed).toHaveLength(sent);
    // the paper trade is the strategy's own 100 lots, with its exits written at once
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id));
    expect(legs.map((l) => l.lots)).toEqual([100, 100, 100, 100]);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).length).toBeGreaterThan(0);
    expect((await linesOf(who, s)).at(-1)!.detail.mode).toBeUndefined();
  });
});

describe("HC-TR-301 a complete live entry", () => {
  it("HC-TR-301 HC-TR-303 HC-TR-306 the trade is live under the mandate's account and lots, bought options go out first, the exits are armed after the fills, it is audited, entered once, and left out of the paper record", async () => {
    const { who, s, mandateId } = await ready("Complete");
    const sent = t.trading.placed.length;
    expect(await pass(true)).toMatchObject({ entered: 0, failed: 0 }); // the paper counter does not move: this entry is the live hook's
    const trades = await tradesOf(who, s);
    expect(trades).toHaveLength(1);
    const trade = trades[0]!;
    expect(trade).toMatchObject({ status: "live", tradingMode: "live", accountId: who.accountId, autopilotMandateId: mandateId, venue: "delta_india", asset: "BTC" });
    expect(Number(trade.marginEstimate)).toBeGreaterThan(0);
    expect(trade.autopilotEntryCompleteAt).not.toBeNull(); // the mark of a finished entry
    expect(await hasIncompleteEntry(t.db, mandateId)).toBe(false);
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade.id)).orderBy(asc(strategyLegs.position));
    expect(legs.map((l) => [l.side, l.kind, l.lots, l.status])).toEqual([["buy", "put", 10, "open"], ["sell", "put", 10, "open"], ["sell", "call", 10, "open"], ["buy", "call", 10, "open"]]);
    // four market orders of 10 contracts, the two bought options before the two sold ones, none reduce-only
    const orders = t.trading.placed.slice(sent).map((o) => o.input);
    expect(orders.map((o) => [o.side, o.size, o.reduceOnly ?? false, o.orderType ?? "market"])).toEqual([["buy", 10, false, "market"], ["buy", 10, false, "market"], ["sell", 10, false, "market"], ["sell", 10, false, "market"]]);
    expect(new Set(orders.map((o) => o.clientOrderId)).size).toBe(4);
    const booked = await t.db.select().from(strategyOrders).where(eq(strategyOrders.strategyId, trade.id));
    expect(booked.map((o) => [o.purpose, o.state])).toEqual(Array(4).fill(["entry", "filled"]));
    // the legs carry their fills, and the exits were armed: a stop on each sold option and the profit take
    expect(legs.every((l) => l.entryPrice === markOf(l.kind as "call" | "put", Number(l.strike)))).toBe(true);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id));
    expect(rules.map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "target"]);
    expect(rules.every((r) => r.state === "armed")).toBe(true);
    // the log line says live and names the mandate; the audit trail has the entry and its fills; the mandate stays active
    const lines = await linesOf(who, s);
    expect(lines.at(-1)).toMatchObject({ kind: "entered", strategyId: trade.id });
    expect(lines.at(-1)!.detail).toMatchObject({ mode: "live", mandateId });
    const audited = (await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.target, `strategy:${trade.id}`))).map((a) => a.action);
    expect(audited).toEqual(expect.arrayContaining(["autopilot.enter_live", "autopilot.live_filled"]));
    expect((await mandateOf(mandateId)).state).toBe("active");

    expect(legs.every((l) => l.openedAt !== null)).toBe(true);

    // the exits are real: the sold put doubles, its stop fires, and ONE reduce-only buy of that option goes to the exchange
    const soldPut = legs.find((l) => l.side === "sell" && l.kind === "put")!;
    const marksNow = Object.fromEntries(legs.map((l) => [l.symbol, Number(l.entryPrice) * (l.id === soldPut.id ? 2.5 : 1)]));
    t.trading.fillAt(productId("put", Number(soldPut.strike)), String(marksNow[soldPut.symbol]));
    const before = t.trading.placed.length;
    const fired = await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map(Object.entries(marksNow)), spot: SPOT }) }, () => W + MIN);
    expect(fired.fired.length).toBeGreaterThan(0);
    const exits = t.trading.placed.slice(before).map((o) => o.input);
    expect(exits.map((o) => [o.side, o.size, o.reduceOnly])).toEqual([["buy", 10, true]]);
    expect(exits[0]!.productId).toBe(productId("put", Number(soldPut.strike)));
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.id, soldPut.id)))[0]).toMatchObject({ status: "squared_off" });

    // HC-TR-303: the next passes hold the trade and send nothing more
    const after = t.trading.placed.length;
    await pass(true);
    await pass(true, W + 6 * MIN);
    expect(await tradesOf(who, s)).toHaveLength(1);
    expect(t.trading.placed).toHaveLength(after);

    // HC-TR-306: a live trade is no part of the strategy's paper record
    const [row] = await t.db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, s.id));
    const { record } = await paperRecordOf(t.db, { id: s.id, publishedAt: row!.publishedAt!.toISOString() }, new Date());
    expect(record).toMatchObject({ accounts: 0, open: 0, closed: 0 });

    // the trader squares it off by hand like any live trade: four reduce-only orders, and it is closed
    const closed = await t.request(`/v1/strategies/${trade.id}/close`, { cookie: who.cookie, method: "POST", json: { exits: {} } });
    expect(closed.status).toBe(200);
    expect(t.trading.placed.slice(after).map((o) => o.input.reduceOnly)).toEqual([true, true, true]); // the three legs still open
    expect((await tradesOf(who, s))[0]).toMatchObject({ status: "archived", closeReason: "squared_off" });
  });
});

describe("HC-TR-300 the gate: every refusal is a line in the log and sends nothing", () => {
  it("HC-TR-300 HC-TR-305 the kill switch, the open-trade limit, the loss limits, the capital, the wallet, a price that moved, a wallet that cannot be read, the order budget", async () => {
    const { who, s, mandateId } = await ready("Gate");
    const sent = t.trading.placed.length;
    const refused = async (text: string | RegExp) => {
      await pass(true);
      expect(await tradesOf(who, s), String(text)).toHaveLength(0);
      expect(t.trading.placed, String(text)).toHaveLength(sent);
      const line = (await linesOf(who, s)).at(-1)!;
      expect(line.kind).toBe("skipped");
      expect(line.detail).toMatchObject({ mode: "live", mandateId });
      if (typeof text === "string") expect(line.reason).toContain(text);
      else expect(line.reason).toMatch(text);
      expect(line.reason.startsWith("Live: ")).toBe(true);
    };
    // the account's kill switch
    await t.db.update(users).set({ tradingDisabled: true }).where(eq(users.id, who.id));
    await refused("Live trading is disabled for this account");
    await t.db.update(users).set({ tradingDisabled: false }).where(eq(users.id, who.id));
    // a trade already open under the mandate (one at a time)
    await t.db.insert(strategies).values({ id: "strat_gate_open", userId: who.id, name: "Other", asset: "ETH", venue: "delta_india", status: "live", tradingMode: "live", autopilotMandateId: mandateId, marginEstimate: "20", startedAt: new Date(W - 3_600_000), autopilotEntryCompleteAt: new Date(W - 3_600_000) });
    await refused("1 live trade is open under this mandate, its limit");
    await t.db.delete(strategies).where(eq(strategies.id, "strat_gate_open"));
    // a loss today at the day's limit (50): counted on trades closed since 00:00 UTC
    const closed = (id: string, pnl: string, at: number) => t.db.insert(strategies).values({ id, userId: who.id, name: "Closed", asset: "ETH", venue: "delta_india", status: "archived", tradingMode: "live", autopilotMandateId: mandateId, realizedPnl: pnl, startedAt: new Date(at - 3_600_000), closedAt: new Date(at) });
    await closed("strat_gate_day", "-50.00", W - 2 * 3_600_000);
    await refused("loss limit for the day (50 USD");
    // the same loss on Wednesday is not today's, and with another on Monday the week's limit (150) is reached; a gain is taken off
    await t.db.update(strategies).set({ closedAt: new Date(W - 2 * DAY), realizedPnl: "-100.00" }).where(eq(strategies.id, "strat_gate_day"));
    await closed("strat_gate_week", "-60.00", W - 4 * DAY + 3_600_000);
    await closed("strat_gate_gain", "9.99", W - DAY);
    await refused("loss limit for the week (150 USD");
    await t.db.update(strategies).set({ realizedPnl: "10.01" }).where(eq(strategies.id, "strat_gate_gain"));
    // 149.99 lost in the week is under the limit: the next refusal is another one. A loss before Monday counts for nothing.
    await closed("strat_gate_old", "-900.00", lossWindows(new Date(W)).week.getTime() - 1);
    await t.db.update(autopilotMandates).set({ maxCapitalUsd: 10 }).where(eq(autopilotMandates.id, mandateId));
    await refused("Live: the estimated margin of this trade, with the mandate's open trades, is above the mandate's capital of 10 USD");
    await t.db.update(autopilotMandates).set({ maxCapitalUsd: 500 }).where(eq(autopilotMandates.id, mandateId));
    // the exchange wallet cannot cover the margin
    t.trading.setBalances([{ asset: "USD", balance: "3", availableBalance: "3" }]);
    await refused("is below the margin the exchange will hold");
    // no settling balance at all
    t.trading.setBalances([{ asset: "BTC", balance: "1", availableBalance: "1" }]);
    await refused("the exchange wallet shows no balance to trade from");
    resetVenue();
    // HC-TR-305: a wallet that cannot be read is a refusal, never "enough"
    const read = t.trading.getBalances.bind(t.trading);
    t.trading.getBalances = () => Promise.reject(new Error("exchange did not answer"));
    await refused("exchange did not answer");
    t.trading.getBalances = read;
    // a sold option whose price at the exchange left the snapshot's
    const legsNow = [symbolOf("put", 82_400), symbolOf("call", 84_000)];
    t.trading.markAt(legsNow[0]!, "900", String(SPOT)).markAt(legsNow[1]!, "900", String(SPOT));
    await refused(/^Live: the price of P-BTC-\d+-260926 at the exchange is beyond the [\d.]+ % band around the snapshot's$/);
    // a leg with no price at the exchange
    t.trading.markAt(legsNow[0]!, "0", String(SPOT));
    await refused("has no price at the exchange or on the snapshot");
    resetVenue();
    // the account's order budget for the minute is spent
    for (let i = 0; i < t.config.orderRateMaxPerMin; i++) await t.deps.rateStore.consume(liveOrderKey(who.accountId), 60_000, t.config.orderRateMaxPerMin);
    await refused("order rate limit of this account is reached");
    await t.deps.rateStore.reset(liveOrderKey(who.accountId));
    // with every refusal lifted the same trader is entered
    await pass(true);
    expect((await tradesOf(who, s)).map((x) => x.status)).toEqual(["live"]);
  });

  it("HC-TR-300 the loss limits count from 00:00 UTC of the day and of the week's Monday", () => {
    expect(lossWindows(new Date(Date.UTC(2026, 8, 25, 16, 5)))).toEqual({ day: new Date(Date.UTC(2026, 8, 25)), week: new Date(Date.UTC(2026, 8, 21)) }); // a Friday
    expect(lossWindows(new Date(Date.UTC(2026, 8, 21, 0, 0)))).toEqual({ day: new Date(Date.UTC(2026, 8, 21)), week: new Date(Date.UTC(2026, 8, 21)) }); // Monday itself
    expect(lossWindows(new Date(Date.UTC(2026, 8, 27, 23, 59)))).toEqual({ day: new Date(Date.UTC(2026, 8, 27)), week: new Date(Date.UTC(2026, 8, 21)) }); // Sunday is the week's last day
  });
});

describe("HC-TR-302 an entry that does not complete", () => {
  it("HC-TR-302 a bought option the exchange refuses stops the entry before any option is sold: nothing is retried or closed, no exit is armed, the mandate is paused with the reason", async () => {
    const { who, s, mandateId } = await ready("Failed buy");
    const sent = t.trading.placed.length;
    // the second bought option (the call wing) is refused
    t.trading.failWith(productId("call", 85_600), "insufficient_margin");
    await pass(true);
    const [trade] = await tradesOf(who, s);
    expect(trade).toMatchObject({ status: "live", autopilotMandateId: mandateId });
    const orders = t.trading.placed.slice(sent).map((o) => o.input);
    expect(orders.every((o) => o.side === "buy")).toBe(true); // no sold option went out
    expect(orders.length).toBeLessThanOrEqual(2);
    const booked = await t.db.select().from(strategyOrders).where(eq(strategyOrders.strategyId, trade!.id)).orderBy(asc(strategyOrders.createdAt));
    expect(booked.map((o) => [o.side, o.state])).toEqual([["buy", "filled"], ["buy", "failed"]]);
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).toEqual([]);
    // only the option the exchange filled is held: the refused one and the two never sent have no entry price and no
    // opening time, which is what the rules engine, the settler and the books read as "never filled"
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    expect(legs.map((l) => [l.side, l.kind, l.entryPrice !== null, l.openedAt !== null, l.status])).toEqual([["buy", "put", true, true, "open"], ["sell", "put", false, false, "squared_off"], ["sell", "call", false, false, "squared_off"], ["buy", "call", false, false, "open"]]);
    // (the two sold options were never sent and are taken off without a price or a result; the refused call keeps its
    // place: an order that has a row is never taken off, since a refusal can still turn out filled at the exchange)
    expect(legs.filter((l) => l.status === "squared_off").every((l) => l.exitPrice === null && l.closedAt !== null)).toBe(true);
    expect(trade!.realizedPnl).toBe("0");
    expect(trade!.autopilotEntryCompleteAt).toBeNull();
    expect(await hasIncompleteEntry(t.db, mandateId)).toBe(true);
    // a rule pass has nothing of this trade to fire: no exit order is booked on it (other tests' trades share the database)
    await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map(legs.map((l) => [l.symbol, 1])), spot: SPOT }) }, () => W + MIN);
    expect((await t.db.select().from(strategyOrders).where(eq(strategyOrders.strategyId, trade!.id))).filter((o) => o.purpose === "exit")).toEqual([]);
    const m = await mandateOf(mandateId);
    expect(m.state).toBe("paused");
    expect(m.pauseReason).toContain("Live entry incomplete");
    expect(m.pauseReason).toContain("1 of 4 legs filled before it");
    expect(m.pauseReason).toContain("No order was retried and none was sent to close anything. 2 legs that were never sent to the exchange were taken off the trade. 2 legs stay on the trade: check what the exchange holds and square it off; this mandate is paused");
    const line = (await linesOf(who, s)).at(-1)!;
    expect(line).toMatchObject({ kind: "noted", strategyId: trade!.id });
    expect(line.detail).toMatchObject({ mode: "live", mandateId });
    expect((await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.target, `strategy:${trade!.id}`))).map((a) => a.action)).toContain("autopilot.live_incomplete");
    // the next passes send nothing: the trade holds the key, and the paused mandate enters nothing live
    const after = t.trading.placed.length;
    t.trading.succeed(productId("call", 85_600));
    await pass(true);
    await pass(true, W + 6 * MIN);
    expect(t.trading.placed).toHaveLength(after);
    expect(await tradesOf(who, s)).toHaveLength(1);
    // the mandate cannot be resumed over it, and an active one would enter nothing on top of it: squared off first
    const audit = () => Promise.resolve();
    expect(await stepMandate(t.db, who.id, mandateId, "resume", new Date(W), audit)).toEqual({ ok: false, why: MANDATE_REFUSALS.incompleteEntry });
    await t.db.update(autopilotMandates).set({ state: "active" }).where(eq(autopilotMandates.id, mandateId));
    const other = await strategy(who, "Second strategy"); // (switching it on drops the first from the trader's list)
    await t.db.update(autopilotMandates).set({ strategyId: other.id }).where(eq(autopilotMandates.id, mandateId));
    await pass(true, W + 12 * MIN);
    expect(await tradesOf(who, other)).toEqual([]);
    expect((await linesOf(who, other)).at(-1)!.reason).toBe("Live: a trade entered under this mandate did not complete: square it off first");
    expect(t.trading.placed).toHaveLength(after);
    // squared off by hand: reduce-only orders for the two legs left on it and none for the two never sent
    const closed = await t.request(`/v1/strategies/${trade!.id}/close`, { cookie: who.cookie, method: "POST", json: { exits: {} } });
    expect([closed.status, t.trading.placed.slice(after).map((o) => [o.input.side, o.input.reduceOnly])]).toEqual([200, [["sell", true], ["sell", true]]]);
    expect(await hasIncompleteEntry(t.db, mandateId)).toBe(false);
  });

  it("HC-TR-302 an error nobody expected after the trade was opened pauses the mandate too: the trade is never left without a word", async () => {
    const { who, s, mandateId } = await ready("Thrown");
    const place = t.trading.placeOrder.bind(t.trading);
    t.trading.placeOrder = () => Promise.reject(new Error("socket hang up"));
    await pass(true);
    t.trading.placeOrder = place;
    const [trade] = await tradesOf(who, s);
    // the request may have reached the exchange: nothing is taken off the trade and it is not closed
    expect(trade).toMatchObject({ status: "live", autopilotEntryCompleteAt: null });
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id))).map((l) => [l.status, l.entryPrice])).toEqual(Array(4).fill(["open", null]));
    const m = await mandateOf(mandateId);
    expect(m.state).toBe("paused");
    expect(m.pauseReason).toContain("socket hang up (an order may or may not have reached the exchange)");
    expect(m.pauseReason).toContain("4 legs stay on the trade: check what the exchange holds and square it off");
    expect(m.pauseReason).not.toContain("taken off");
    expect(await hasIncompleteEntry(t.db, mandateId)).toBe(true);
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).toEqual([]);
  });

  it("HC-TR-302 an order that only partly fills stops the entry the same way", async () => {
    const { who, s, mandateId } = await ready("Partial");
    const sent = t.trading.placed.length;
    t.trading.partialNextOrder();
    await pass(true);
    expect(t.trading.placed.slice(sent)).toHaveLength(1); // the first bought option, and nothing after it
    expect((await mandateOf(mandateId)).state).toBe("paused");
    const [trade] = await tradesOf(who, s);
    // the order that is still open at the exchange keeps its leg (it may yet fill); the three never sent are taken off
    expect(trade!.status).toBe("live");
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position))).map((l) => l.status)).toEqual(["open", "squared_off", "squared_off", "squared_off"]);
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).toEqual([]);
  });

  it("HC-TR-303 an entry the pass that opened it never finished is found on a later pass and pauses its mandate, once", async () => {
    const { who, s, mandateId } = await ready("Stranded");
    // the row and its legs as the entry writes them, and then nothing: the server stopped before the first order
    await t.db.insert(strategies).values({ id: "strat_stranded", userId: who.id, name: "Stranded", asset: "BTC", venue: "delta_india", status: "live", tradingMode: "live", accountId: who.accountId, autopilotPlaybookId: s.id, autopilotStructure: "x", autopilotMandateId: mandateId, startedAt: new Date(W - 10 * MIN), createdAt: new Date(W) }); // the grace runs from the row's own creation, not the start of its pass
    await t.db.insert(strategyLegs).values({ id: "leg_stranded", strategyId: "strat_stranded", kind: "put", side: "buy", strike: "80600", expiry: EXPIRY, symbol: symbolOf("put", 80_600), lots: 10, price: "70", entryPrice: null, openedAt: null, status: "open", position: 0 });
    const sent = t.trading.placed.length;
    // inside its grace it is left alone: the pass that opened it may still be placing its orders
    expect(await sweepIncompleteLive(t.deps, new Date(W + LIVE_ENTRY_GRACE_MS - 1))).toBe(0);
    expect((await mandateOf(mandateId)).state).toBe("active");
    expect(await sweepIncompleteLive(t.deps, new Date(W + LIVE_ENTRY_GRACE_MS + 1))).toBe(1);
    expect(await mandateOf(mandateId)).toMatchObject({ state: "paused" });
    expect((await mandateOf(mandateId)).pauseReason).toContain("was not finished by the pass that opened it");
    expect(await sweepIncompleteLive(t.deps, new Date(W + 10 * MIN))).toBe(0); // once
    expect(t.trading.placed).toHaveLength(sent); // nothing sent
    // the server may have stopped after an order left and before it was written down: nothing is taken off or closed
    expect((await t.db.select().from(strategies).where(eq(strategies.id, "strat_stranded")))[0]!.status).toBe("live");
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.id, "leg_stranded")))[0]!.status).toBe("open");
    expect((await mandateOf(mandateId)).pauseReason).toContain("1 leg stays on the trade: check what the exchange holds and square it off");
    // every leg filled but the server stopped before the exits were armed: no mark of completion, so it is found too
    await t.db.update(autopilotMandates).set({ state: "active" }).where(eq(autopilotMandates.id, mandateId));
    await t.db.update(strategyLegs).set({ entryPrice: "70", openedAt: new Date(W) }).where(eq(strategyLegs.id, "leg_stranded"));
    await t.db.insert(strategyOrders).values({ id: "ord_stranded", strategyId: "strat_stranded", legId: "leg_stranded", batchId: "ap-strat_stranded", purpose: "entry", clientOrderId: "hc-leg_stranded-1", productId: 1, symbol: symbolOf("put", 80_600), side: "buy", size: 10, state: "filled", fillPrice: "70" });
    expect(await sweepIncompleteLive(t.deps, new Date(W + 10 * MIN))).toBe(1);
    expect((await t.db.select().from(strategies).where(eq(strategies.id, "strat_stranded")))[0]!.status).toBe("live"); // its filled leg is held: it stays for the trader
    // and a trade that DID complete is never looked at again, whatever is added to it later (a leg with no entry order)
    await t.db.update(autopilotMandates).set({ state: "active" }).where(eq(autopilotMandates.id, mandateId));
    await t.db.update(strategies).set({ autopilotEntryCompleteAt: new Date(W) }).where(eq(strategies.id, "strat_stranded"));
    await t.db.insert(strategyLegs).values({ id: "leg_added", strategyId: "strat_stranded", kind: "call", side: "buy", strike: "85600", expiry: EXPIRY, symbol: symbolOf("call", 85_600), lots: 10, price: "80", entryPrice: null, status: "open", position: 1 });
    expect(await sweepIncompleteLive(t.deps, new Date(W + 20 * MIN))).toBe(0);
    expect((await mandateOf(mandateId)).state).toBe("active");
  });
});

describe("HC-TR-304 what stops new live entries", () => {
  it("HC-TR-304 a withdrawn approval, a paused or ended mandate and a removed account each leave the trader on paper; no order is sent", async () => {
    const sent = t.trading.placed.length;
    const cases: [string, (x: Awaited<ReturnType<typeof ready>>) => Promise<unknown>][] = [
      ["Withdrawn", (x) => t.db.update(autopilotSavedStrategies).set({ approval: null }).where(eq(autopilotSavedStrategies.id, x.s.id))],
      ["Paused", (x) => t.db.update(autopilotMandates).set({ state: "paused" }).where(eq(autopilotMandates.id, x.mandateId))],
      ["Ended", (x) => t.db.update(autopilotMandates).set({ state: "ended" }).where(eq(autopilotMandates.id, x.mandateId))],
      ["No account", (x) => t.db.update(autopilotMandates).set({ accountId: null }).where(eq(autopilotMandates.id, x.mandateId))],
      // a mandate that names an account of somebody else (written past the signing) trades nothing live
      ["Not their account", async (x) => t.db.update(autopilotMandates).set({ accountId: (await trader()).accountId }).where(eq(autopilotMandates.id, x.mandateId))],
    ];
    for (const [name, undo] of cases) {
      const x = await ready(name);
      await undo(x);
      await pass(true);
      expect((await tradesOf(x.who, x.s)).map((r) => [r.status, r.tradingMode, r.autopilotMandateId]), name).toEqual([["paper", "paper", null]]);
      // (its own trader only: the next case starts with this one switched off)
      await t.request("/v1/autopilot", { cookie: x.who.cookie, method: "PUT", json: { enabled: false, strategies: [] } });
    }
    expect(t.trading.placed).toHaveLength(sent);
  });

  it("HC-TR-304 an approval withdrawn between the gate and the write enters nothing, live or paper, on that pass", async () => {
    const { who, s } = await ready("Raced");
    const sent = t.trading.placed.length;
    // the wallet read is the last thing the gate does before the write: the approval goes while it is being read
    const read = t.trading.getBalances.bind(t.trading);
    t.trading.getBalances = async (...a) => {
      await t.db.update(autopilotSavedStrategies).set({ approval: null }).where(eq(autopilotSavedStrategies.id, s.id));
      return read(...a);
    };
    await pass(true);
    t.trading.getBalances = read;
    expect(await tradesOf(who, s)).toEqual([]);
    expect(t.trading.placed).toHaveLength(sent);
  });
});

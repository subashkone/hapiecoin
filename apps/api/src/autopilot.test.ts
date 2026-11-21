// Autopilot (ADR-108; HC-TR-216, HC-TR-217, HC-TR-218): on the marks of the newest snapshot the engine opens a PAPER
// strategy for every trader who switched an entering playbook on, with its exits armed and a log line; one open trade
// per trader, playbook, venue and asset; a cool-down after a trade ends; a better entry while one is open is noted;
// every reason not to enter is logged once. Nothing here places anything on a venue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAYBOOKS, type PlaybookProposal, playbookById } from "@hapiecoin/pricing";
import { AUTOPILOT_COOLDOWN_MINUTES, AUTOPILOT_PAPER_ONLY_MESSAGE, AUTOPILOT_RUNS_RETENTION_DAYS, type AutopilotView, type Instrument, type Quote, type SubscriptionView } from "@hapiecoin/schema";
import { and, eq } from "drizzle-orm";
import { AUTOPILOT_MAX_MARK_AGE_MS, type AutopilotDeps, betterEntry, liveDay, planFor, runAutopilot, skipText } from "./autopilot.js";
import { clearEodMemo } from "./chain-eod.js";
import { autopilotRuns, instrumentMarks, ivSnapshots, plans, strategies, subscriptions, strategyLegs, strategyRules, userSettings, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type RulesTickSource, evaluateRules } from "./rules-engine.js";
import { snapshotOnce, type MarketSource } from "./iv-snapshot.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
let userId: string;
const EMAIL = "autopilot@hapiecoin.test";
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp(EMAIL)).cookie;
  userId = ((await (await t.request("/v1/me", { cookie })).json()) as { id: string }).id;
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
/** The newest pass: day 8 at 10:00 UTC, two hours before the settlement write, so day 8 has marks and no recorded chain. */
const LIVE = T0 + 8 * DAY - 2 * HOUR;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** Ten strikes on two expiries. `timeValue` is what every option carries over its intrinsic value. */
const STRIKES = [79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000, 86_000, 87_000, 88_000];
function sourceAt(ts: number, spot: number, timeValue = 400, strikes: readonly number[] = STRIKES): MarketSource {
  const expiries = ["2026-09-15", "2026-10-20"];
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of expiries)
    for (const k of strikes) {
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: String(Math.max(spot - k, 0) + timeValue), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts, mark: String(Math.max(k - spot, 0) + timeValue), oi: "1", spot: String(spot), markIv: 0.4 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const spotOn = (dayIndex: number) => 80_000 + dayIndex * 400;
const deps = (nowMs: number, over: Partial<AutopilotDeps> = {}): AutopilotDeps => ({ db: t.db, logger: t.deps.logger, now: () => nowMs, ...over });
const put = (body: unknown, c = cookie) => t.request("/v1/autopilot", { cookie: c, method: "PUT", json: body });
const view = async (c = cookie) => json<AutopilotView>(await t.request("/v1/autopilot", { cookie: c }));
const mine = () => t.db.select().from(strategies).where(eq(strategies.userId, userId));
const BUTTERFLY = "pin-butterfly"; // no entry condition, 1 day out: enters on any chain it fits

describe("HC-TR-216 the trader's Autopilot settings", () => {
  it("HC-TR-216 off and empty by default; saves the switch and the playbooks; refuses the control, an unknown playbook and a repeat; needs a session", async () => {
    expect((await t.request("/v1/autopilot")).status).toBe(401);
    expect((await t.request("/v1/autopilot", { method: "PUT", json: { enabled: true, strategies: [] } })).status).toBe(401);
    expect(await view()).toEqual({ settings: { enabled: false, strategies: [] }, runs: [] });
    const control = PLAYBOOKS.find((p) => p.control)!;
    const refused = await put({ enabled: true, strategies: [{ playbookId: control.id, exit: "trail" }] });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain(`${control.id} is not a playbook Autopilot can trade`);
    expect((await put({ enabled: true, strategies: [{ playbookId: "nope", exit: "trail" }] })).status).toBe(400);
    expect((await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }, { playbookId: BUTTERFLY, exit: "target" }] })).status).toBe(400);
    expect((await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "sometimes" }] })).status).toBe(400);
    const saved = await json<AutopilotView>(await put({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] }));
    expect(saved.settings).toEqual({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect((await view()).settings).toEqual(saved.settings);
  });
});

describe("HC-TR-217 the pieces an entry is decided on", () => {
  const butterfly = playbookById(BUTTERFLY)!;
  const proposal = (over: Partial<PlaybookProposal> = {}): PlaybookProposal => ({
    day: "2026-09-09",
    spot: 80_000,
    expiry: "2026-09-15",
    legs: [
      { asset: "BTC", kind: "call", side: "buy", strike: "79000", expiry: "2026-09-15", lots: 10, price: "1400" },
      { asset: "BTC", kind: "call", side: "sell", strike: "80000", expiry: "2026-09-15", lots: 10, price: "400" },
    ],
    entryCost: 10,
    maxProfit: 0,
    maxLoss: -10, // the expiry extremes give the loss as a negative P&L
    ...over,
  });
  const rule = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };

  it("HC-TR-217 the target is ten per cent of the most the trade can make plus the entry and exit fees; the stop and the time exit come from the playbook", () => {
    // two legs of 10 lots x 0.001: notional 800 each, fee 0.08 each (far under the 3.5 % premium cap), 18 % GST
    const p = planFor({ ...butterfly, exits: { stopPct: 0.5, timeStopDte: 2 } }, proposal({ maxProfit: 40 }), 0.001, rule)!;
    expect(p.fees).toBeCloseTo(2 * 2 * 0.08 * 1.18, 10);
    expect(p.targetUsd).toBeCloseTo(4 + p.fees, 10);
    expect(p.stopUsd).toBe(5);
    expect(p.timeStopDte).toBe(2);
    // no fee rule on the venue: no fees; a playbook with no stop and no time exit arms neither
    expect(planFor({ ...butterfly, exits: undefined }, proposal({ maxProfit: 40 }), 0.001, null)).toEqual({ fees: 0, targetUsd: 4, stopUsd: null, timeStopDte: null });
  });

  it("HC-TR-217 no plan when the fees eat the trade (small premiums close to expiry) or the structure has no defined maximum", () => {
    expect(planFor(butterfly, proposal({ maxProfit: 0.4 }), 0.001, rule)).toBeNull(); // 0.04 + 0.38 of fees is not below 0.40
    expect(planFor(butterfly, proposal({ maxProfit: Infinity }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 40, maxLoss: -Infinity }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 0 }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 40, maxLoss: 0 }), 0.001, rule)).toBeNull();
    // a level that rounds to nothing would fire on the first tick
    expect(planFor(butterfly, proposal({ maxProfit: 0.05 }), 0.001, null)).toBeNull();
    expect(planFor({ ...butterfly, exits: { stopPct: 0.0001 } }, proposal({ maxProfit: 40 }), 0.001, null)).toBeNull();
  });

  it("HC-TR-218 a better entry is ten per cent more credit or ten per cent less debit than the open trade's", () => {
    expect(betterEntry(-110, -100)).toBe(true);
    expect(betterEntry(-109, -100)).toBe(false);
    expect(betterEntry(90, 100)).toBe(true);
    expect(betterEntry(91, 100)).toBe(false);
    expect(betterEntry(-5, 0)).toBe(false);
    expect(betterEntry(0.04, 0.04)).toBe(false); // a few cents: the same price is not a better one
    expect(betterEntry(0.03, 0.04)).toBe(true);
    expect(skipText("noSignal")).toBe("Its entry conditions are not met");
  });
});

describe("HC-TR-217 the entry engine", () => {
  it("HC-TR-217 does nothing while nobody has Autopilot on; a pass without a fresh snapshot is a logged reason, written once", async () => {
    clearEodMemo();
    expect(await runAutopilot(deps(LIVE), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }, { playbookId: "trend-calls", exit: "target" }, { playbookId: "covered-call", exit: "target" }] });
    expect(await liveDay(t.db, "delta_india", "BTC", LIVE, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull(); // no marks yet
    // three playbooks on the two underlyings Autopilot trades
    expect(await runAutopilot(deps(LIVE), ["delta_india"])).toEqual({ entered: 0, skipped: 6, noted: 0, failed: 0 });
    expect(await runAutopilot(deps(LIVE + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    const runs = (await view()).runs;
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map((r) => r.reason))).toEqual(new Set(["No fresh prices: the newest market snapshot is missing or too old"]));
    expect(await mine()).toHaveLength(0);
  });

  it("HC-TR-217 enters the playbook whose plan enters, on paper at the snapshot's marks with its exits armed; the others say why not; nothing twice", async () => {
    clearEodMemo();
    for (let d = 0; d <= 7; d++) await snapshotOnce(t.deps, sourceAt(T0 + d * DAY + HOUR, spotOn(d)), () => T0 + d * DAY + HOUR);
    await snapshotOnce(t.deps, sourceAt(LIVE, spotOn(8)), () => LIVE);
    const day = (await liveDay(t.db, "delta_india", "BTC", LIVE + MIN, AUTOPILOT_MAX_MARK_AGE_MS))!;
    expect(day).toMatchObject({ day: "2026-09-09", spot: spotOn(8), source: "snapshot" });
    expect(day.expiries.map((e) => e.expiry)).toEqual(["2026-09-15", "2026-10-20"]);
    expect(day.expiries[0]!.rows.map((r) => r.strike)).toEqual([79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000, 86_000, 87_000, 88_000]);
    expect(await liveDay(t.db, "delta_india", "BTC", LIVE + AUTOPILOT_MAX_MARK_AGE_MS + 1, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull(); // too old to enter on

    const pass = await runAutopilot(deps(LIVE + MIN), ["delta_india"]);
    expect(pass).toEqual({ entered: 1, skipped: 2, noted: 0, failed: 0 });
    const [s] = await mine();
    expect(s).toMatchObject({ name: `${playbookById(BUTTERFLY)!.name} · Autopilot`, status: "paper", tradingMode: "paper", asset: "BTC", venue: "delta_india", autopilotPlaybookId: BUTTERFLY, tags: ["autopilot"], realizedPnl: "0" });
    expect(s!.startedAt!.getTime()).toBe(LIVE + MIN);
    expect(s!.brokerId).not.toBeNull();
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, s!.id));
    expect(legs).toHaveLength(3);
    for (const l of legs) {
      expect(l).toMatchObject({ kind: "call", status: "open", expiry: "2026-09-15", entryPrice: l.price });
      expect(l.symbol).toBe(`C-BTC-${l.strike}-150926`);
      // the fill is that strike's mark in the snapshot: intrinsic value plus 400
      expect(Number(l.price)).toBe(Math.max(spotOn(8) - Number(l.strike), 0) + 400);
    }
    const entered = (await view()).runs.find((r) => r.kind === "entered")!;
    expect(entered).toMatchObject({ playbookId: BUTTERFLY, venue: "delta_india", asset: "BTC", strategyId: s!.id, reason: "Its entry conditions were met on the latest prices" });
    expect(entered.detail).toMatchObject({ spot: "83200", expiry: "2026-09-15", dte: 6, exit: "trail", stopUsd: null });
    expect(entered.detail.legs).toHaveLength(3);
    expect(Number(entered.detail.capital)).toBe(-Number(entered.detail.maxLoss)); // the capital is the most it can lose
    // ten per cent of the most it can make, plus both fees
    const d = entered.detail;
    expect(Number(d.targetUsd)).toBeCloseTo(Number(d.maxProfit) * 0.1 + Number(d.fees), 1);
    expect(Number(d.fees)).toBeGreaterThan(0);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id));
    expect(rules).toHaveLength(1); // the butterfly's playbook has no stop and no time exit: its risk is the debit paid
    expect(rules[0]).toMatchObject({ kind: "target", trigger: "money", value: d.targetUsd, thresholdUsd: d.targetUsd, trailTrigger: "pct", trailValue: "10", state: "armed", scope: "strategy", channels: ["push", "telegram"] });

    const reasons = new Map((await view()).runs.filter((r) => r.asset === "BTC" && r.kind === "skipped" && r.reason !== "No fresh prices: the newest market snapshot is missing or too old").map((r) => [r.playbookId, r.reason]));
    expect(reasons.get("trend-calls")).toBe("Its entry conditions are not met"); // eight recorded days are not a 50-day average
    expect(reasons.get("covered-call")).toBe("A futures leg needs a margin figure Autopilot does not have yet");

    // the next pass: the trade is open, the reasons have not changed
    expect(await runAutopilot(deps(LIVE + 2 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    expect(await mine()).toHaveLength(1);
  });

  it("HC-TR-217 Autopilot's paper trades do not use the trader's monthly paper allowance", async () => {
    const sub = await json<SubscriptionView>(await t.request("/v1/subscription", { cookie }));
    expect(sub.entitlements.find((e) => e.key === "paper_trading")!.used).toBe(0);
  });

  it("HC-TR-218 while a trade is open, a clearly better price for the same structure is noted, once per cool-down", async () => {
    // the same spot with far less time value in every option: the butterfly's debit does not move, so nothing is noted
    await snapshotOnce(t.deps, sourceAt(LIVE + 5 * MIN, spotOn(8), 100), () => LIVE + 5 * MIN);
    expect((await runAutopilot(deps(LIVE + 6 * MIN), ["delta_india"])).noted).toBe(0);
    // the open trade's entry is rewritten dearer in the log, as if the market had since become cheaper by a quarter
    const [entry] = await t.db.select().from(autopilotRuns).where(and(eq(autopilotRuns.userId, userId), eq(autopilotRuns.kind, "entered")));
    const fresh = Number(entry!.detail.entryCost);
    expect(fresh).toBeGreaterThan(0); // a debit structure
    await t.db.update(autopilotRuns).set({ detail: { ...entry!.detail, entryCost: (fresh * 1.25).toFixed(2) } }).where(eq(autopilotRuns.id, entry!.id));
    expect((await runAutopilot(deps(LIVE + 7 * MIN), ["delta_india"])).noted).toBe(1);
    expect((await runAutopilot(deps(LIVE + 8 * MIN), ["delta_india"])).noted).toBe(0);
    const note = (await view()).runs.find((r) => r.kind === "noted")!;
    expect(note).toMatchObject({ playbookId: BUTTERFLY, strategyId: entry!.strategyId, reason: "A better entry than the open trade's: not taken, one trade at a time" });
    expect(Number(note.detail.openEntryCost)).toBe(fresh * 1.25);
    expect(await mine()).toHaveLength(1);
  });

  it("HC-TR-217 after the trade ends the playbook waits the cool-down, says so once, then enters again with the trader's other exit style", async () => {
    const [open] = await mine();
    const closedAt = LIVE + 9 * MIN;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(closedAt), closeReason: "target" }).where(eq(strategies.id, open!.id));
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
    await snapshotOnce(t.deps, sourceAt(LIVE + 10 * MIN, spotOn(8)), () => LIVE + 10 * MIN);
    expect(await runAutopilot(deps(LIVE + 11 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 1, noted: 0, failed: 0 });
    expect((await view()).runs[0]).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    expect(await runAutopilot(deps(LIVE + 12 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    // one minute short of the cool-down, then at it
    await snapshotOnce(t.deps, sourceAt(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - MIN, spotOn(8)), () => closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - MIN);
    expect((await runAutopilot(deps(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - 1), ["delta_india"])).entered).toBe(0);
    expect((await runAutopilot(deps(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN), ["delta_india"])).entered).toBe(1);
    const all = await mine();
    expect(all).toHaveLength(2);
    const second = all.find((x) => x.status === "paper")!;
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, second.id));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "target", trailTrigger: null, trailValue: null }); // closes at the level, no trail
    expect((await view()).runs[0]!.detail.exit).toBe("target");
  });

  it("HC-TR-217 a trader who switches Autopilot off, or whose account is deactivated, gets no entry; one trader's failure does not stop the pass", async () => {
    const [open] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.status, "paper")));
    const later = LIVE + 3 * HOUR;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(LIVE + HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8)), () => later);
    await t.db.update(users).set({ active: false }).where(eq(users.id, userId));
    expect(await runAutopilot(deps(later + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    await t.db.update(users).set({ active: true }).where(eq(users.id, userId));
    await put({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect(await runAutopilot(deps(later + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    // two traders on the same playbook; the first write of the pass fails: that trader is logged and left, the other enters
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    const other = await t.signUp("autopilot-2@hapiecoin.test");
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] }, other.cookie);
    let thrown = false;
    const flaky = new Proxy(t.db, {
      get(target, prop) {
        if (prop === "transaction" && !thrown) {
          thrown = true;
          return () => Promise.reject(new Error("the database said no"));
        }
        const v: unknown = Reflect.get(target, prop);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const warned: object[] = [];
    const pass = await runAutopilot(deps(later + MIN, { db: flaky, logger: { info: () => undefined, warn: (o) => void warned.push(o) } }), ["delta_india"]);
    expect(pass).toMatchObject({ entered: 1, failed: 1 });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ playbookId: BUTTERFLY, asset: "BTC", reason: "the database said no" });
    // the trader left out enters on the next pass; nobody holds two
    expect((await runAutopilot(deps(later + 2 * MIN), ["delta_india"])).entered).toBe(1);
    const openNow = await t.db.select({ userId: strategies.userId }).from(strategies).where(and(eq(strategies.autopilotPlaybookId, BUTTERFLY), eq(strategies.status, "paper")));
    expect(openNow).toHaveLength(2);
    expect(new Set(openNow.map((x) => x.userId)).size).toBe(2);
  });

  it("HC-TR-217 a leg with no price, a venue with no paper exchange, and a snapshot with no spot or no options are reasons, never a trade", async () => {
    // every option at its intrinsic value: the butterfly's far wing is worth nothing, so there is no price to enter it at
    const [open] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.status, "paper")));
    const later = LIVE + 6 * HOUR;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(later - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8), 0), () => later);
    const pass = await runAutopilot(deps(later + MIN), ["delta_india"]);
    expect(pass).toMatchObject({ entered: 0, failed: 0 });
    expect((await view()).runs[0]).toMatchObject({ kind: "skipped", playbookId: BUTTERFLY, asset: "BTC", reason: "A leg of the structure has no price" });
    // Deribit has no paper exchange row: a reason per switched-on playbook and underlying
    const deribit = await runAutopilot(deps(later + 2 * MIN), ["deribit"]);
    expect(deribit).toMatchObject({ entered: 0, failed: 0 });
    expect((await view()).runs.filter((r) => r.venue === "deribit").map((r) => r.reason)).toEqual(["No paper exchange is set up for this venue", "No paper exchange is set up for this venue"]);
    // ETH: marks of a pass with no spot stored for it, then with a spot but nothing that is an option
    const ts = new Date(later);
    await t.db.insert(instrumentMarks).values({ venue: "delta_india", asset: "ETH", symbol: "ETHUSD", ts, mark: "3000", markIv: null });
    expect(await liveDay(t.db, "delta_india", "ETH", later + MIN, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull();
    await t.db.insert(ivSnapshots).values({ venue: "delta_india", asset: "ETH", expiry: "2026-09-15", ts, atmIv: "0.5", spot: "3000", atmStrike: "3000", front: true });
    expect(await liveDay(t.db, "delta_india", "ETH", later + MIN, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull();
  });

  it("HC-TR-217 a playbook with a stop and a time exit arms all three rules; a structure with nothing left to make is a reason", async () => {
    // fifty-two earlier recorded days of a rising spot give the trend playbook its 50-day average
    for (let d = -52; d <= -1; d++) await snapshotOnce(t.deps, sourceAt(T0 + d * DAY + HOUR, spotOn(d)), () => T0 + d * DAY + HOUR);
    const later = LIVE + 9 * HOUR;
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8)), () => later);
    await put({ enabled: true, strategies: [{ playbookId: "trend-calls", exit: "target" }] });
    expect((await runAutopilot(deps(later + MIN), ["delta_india"])).entered).toBe(1);
    const [s] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.autopilotPlaybookId, "trend-calls")));
    expect(s).toMatchObject({ status: "paper", name: `${playbookById("trend-calls")!.name} · Autopilot`, templateName: "Bull Call Spread" });
    const entered = (await view()).runs.find((r) => r.kind === "entered" && r.playbookId === "trend-calls")!;
    const d = entered.detail;
    expect(d.expiry).toBe("2026-10-20"); // at least 14 days out
    const rules = new Map((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id))).map((r) => [r.kind, r]));
    expect([...rules.keys()].sort()).toEqual(["stop", "target", "time"]);
    expect(rules.get("target")).toMatchObject({ trigger: "money", thresholdUsd: d.targetUsd, trailTrigger: null });
    // the playbook stops at half of the most it can lose: the level is that loss as a negative P&L
    expect(Number(d.stopUsd)).toBeCloseTo(-Number(d.maxLoss) * 0.5, 1);
    expect(rules.get("stop")).toMatchObject({ trigger: "money", value: d.stopUsd, state: "armed" });
    expect(Number(rules.get("stop")!.thresholdUsd)).toBe(-Number(d.stopUsd));
    expect(rules.get("time")).toMatchObject({ trigger: "dte", value: "2", thresholdUsd: "2" });

    // strikes 100 apart: the butterfly costs as much as it can ever pay, so there is no profit to aim at
    const narrow = Array.from({ length: 10 }, (_, i) => 82_800 + i * 100);
    await snapshotOnce(t.deps, sourceAt(later + 5 * MIN, spotOn(8), 400, narrow), () => later + 5 * MIN);
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect(await runAutopilot(deps(later + 6 * MIN), ["delta_india"])).toMatchObject({ entered: 0, failed: 0 });
    const last = (await view()).runs.find((r) => r.playbookId === BUTTERFLY && r.asset === "BTC")!;
    expect(last).toMatchObject({ kind: "skipped", reason: "The fees are larger than the profit target, or the structure has no defined maximum" });
    expect(last.detail.maxProfit).toBe("0");
  });
});

describe("HC-TR-217 an Autopilot trade from its exit to the next entry", () => {
  const X = LIVE + 12 * HOUR; // 22:00 UTC on day 8
  const ticks = (m: Record<string, number>): RulesTickSource => ({ tick: () => Promise.resolve({ marks: new Map(Object.entries(m)), spot: null }) });
  const paper = () => t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.autopilotPlaybookId, BUTTERFLY), eq(strategies.status, "paper")));
  const lastButterfly = async () => (await view()).runs.find((r) => r.playbookId === BUTTERFLY && r.asset === "BTC")!;

  it("HC-TR-217 the levels use the trader's own lot size; the rules engine fires the target on paper and the close starts the cool-down", async () => {
    await t.db.insert(userSettings).values({ userId, lotSizes: { BTC: "0.002", ETH: "0.01", XAUT: "0.001" } }).onConflictDoUpdate({ target: userSettings.userId, set: { lotSizes: { BTC: "0.002", ETH: "0.01", XAUT: "0.001" } } });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
    await snapshotOnce(t.deps, sourceAt(X, spotOn(8)), () => X);
    expect((await runAutopilot(deps(X + MIN), ["delta_india"])).entered).toBe(1);
    const [s] = await paper();
    const entered = await lastButterfly();
    expect(entered).toMatchObject({ kind: "entered", strategyId: s!.id });
    expect(entered.detail.maxProfit).toBe("4"); // twice the 2 of a 0.001 lot
    expect(entered.detail.maxLoss).toBe("-36");
    // the bought 81000 call gains 600: 600 x 10 lots x 0.002 = 12 USD, past the target
    const fired = await evaluateRules(t.deps, ticks({ "C-BTC-81000-150926": 3200, "C-BTC-83000-150926": 600, "C-BTC-85000-150926": 400 }), () => X + 2 * MIN);
    expect(fired.fired.length).toBeGreaterThanOrEqual(1);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, s!.id));
    expect(after).toMatchObject({ status: "archived", closeReason: "target" });
    expect(Number(after!.realizedPnl)).toBe(12);
    expect(after!.closedAt!.getTime()).toBe(X + 2 * MIN);
    expect(await runAutopilot(deps(X + 3 * MIN), ["delta_india"])).toMatchObject({ entered: 0, failed: 0 });
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    expect(await paper()).toHaveLength(0);
  });

  it("HC-TR-217 a trade the trader squares off by hand is closed out, starts the cool-down, and does not block the playbook", async () => {
    const at = X + 20 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]); // the second trader's butterfly re-enters on the same passes
    expect(await paper()).toHaveLength(1);
    const [s] = await paper();
    // every leg closed by hand: the row itself stays "paper" (only a rule or the settler archives)
    await t.db.update(strategyLegs).set({ status: "squared_off", exitPrice: "1", closedAt: new Date(at + 2 * MIN), closeReason: "squared_off" }).where(eq(strategyLegs.strategyId, s!.id));
    expect(await runAutopilot(deps(at + 3 * MIN), ["delta_india"])).toMatchObject({ entered: 0, noted: 0, failed: 0 });
    const [closed] = await t.db.select().from(strategies).where(eq(strategies.id, s!.id));
    expect(closed).toMatchObject({ status: "archived", closeReason: "squared_off" });
    expect(closed!.closedAt!.getTime()).toBe(at + 2 * MIN);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id))).map((r) => r.state)).toEqual(["disarmed"]);
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    // a row with no leg at all is closed out as of the pass
    const bare = "strat_autopilot_bare";
    await t.db.insert(strategies).values({ id: bare, userId, name: "bare", asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", autopilotPlaybookId: "expiry-week-credit", startedAt: new Date(at) });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }, { playbookId: "expiry-week-credit", exit: "trail" }] });
    await runAutopilot(deps(at + 4 * MIN), ["delta_india"]);
    const [gone] = await t.db.select().from(strategies).where(eq(strategies.id, bare));
    expect(gone!.status).toBe("archived");
    expect(gone!.closedAt!.getTime()).toBe(at + 4 * MIN);
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
  });

  it("HC-TR-217 an Autopilot trade cannot go live, alone or in a batch, and the database holds one open trade per playbook", async () => {
    const at = X + 40 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]); // the second trader's butterfly re-enters on the same passes
    expect(await paper()).toHaveLength(1);
    const [s] = await paper();
    const single = await t.request(`/v1/strategies/${s!.id}/live/place`, { cookie, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "autopilot-live-001", expected: {} } });
    expect(single.status).toBe(409);
    expect(JSON.stringify(await single.json())).toContain(AUTOPILOT_PAPER_ONLY_MESSAGE);
    const batch = await t.request("/v1/strategies/live/batch", { cookie, json: { confirm: "LIVE", ids: [s!.id], brokerId: SEED.brokerId, idempotencyKey: "autopilot-live-002" } });
    expect(batch.status).toBe(409);
    expect(JSON.stringify(await batch.json())).toContain(AUTOPILOT_PAPER_ONLY_MESSAGE);
    expect((await paper())[0]).toMatchObject({ status: "paper", tradingMode: "paper" });
    // a second open row for the same trader, playbook, venue and asset is refused by the index
    const second = { id: "strat_autopilot_twin", userId, name: "twin", asset: "BTC" as const, venue: "delta_india" as const, status: "paper" as const, tradingMode: "paper" as const, autopilotPlaybookId: BUTTERFLY as string | null };
    await expect(t.db.insert(strategies).values(second)).rejects.toThrow();
    // the trader's own paper trades are not held to it
    await t.db.insert(strategies).values([{ ...second, id: "strat_own_1", autopilotPlaybookId: null }, { ...second, id: "strat_own_2", autopilotPlaybookId: null }]);
    await t.db.delete(strategies).where(eq(strategies.name, "twin"));
  });

  it("HC-TR-218 a cheaper price for a different structure is not a better entry for the open trade", async () => {
    const at = X + 45 * MIN;
    const [entry] = await t.db.select().from(autopilotRuns).where(and(eq(autopilotRuns.userId, userId), eq(autopilotRuns.kind, "entered"), eq(autopilotRuns.strategyId, (await paper())[0]!.id)));
    await t.db.update(autopilotRuns).set({ detail: { ...entry!.detail, entryCost: "500" } }).where(eq(autopilotRuns.id, entry!.id));
    // strikes 100 apart: the butterfly now sits on other strikes and costs far less than 500
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8), 400, Array.from({ length: 10 }, (_, i) => 82_800 + i * 100)), () => at);
    expect((await runAutopilot(deps(at + MIN), ["delta_india"])).noted).toBe(0);
    // the same strikes again: now it is the same structure, and cheaper
    await snapshotOnce(t.deps, sourceAt(at + 5 * MIN, spotOn(8)), () => at + 5 * MIN);
    expect((await runAutopilot(deps(at + 6 * MIN), ["delta_india"])).noted).toBe(1);
  });

  it("HC-TR-217 no plan, no trade: with no Free plan on offer a trader without a subscription is told so; an admin still trades", async () => {
    const at = X + 3 * HOUR;
    const [open] = await paper();
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(at - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await t.db.update(plans).set({ active: false }).where(eq(plans.id, SEED.plans.free));
    await t.db.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.userId, userId));
    try {
      expect((await runAutopilot(deps(at + MIN), ["delta_india"])).failed).toBe(0);
      expect(await paper()).toHaveLength(0);
      expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: "No active plan: choose a plan to let Autopilot trade" });
      await t.db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
      await runAutopilot(deps(at + 2 * MIN), ["delta_india"]);
      expect(await paper()).toHaveLength(1);
    } finally {
      await t.db.update(plans).set({ active: true }).where(eq(plans.id, SEED.plans.free));
      await t.db.update(users).set({ role: "user" }).where(eq(users.id, userId));
    }
  });

  it("HC-TR-217 another pass that got there first is not a failure; a failure on one underlying leaves the other; old log lines are dropped", async () => {
    const at = X + 5 * HOUR;
    const [open] = await paper();
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(at - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    const bound = (target: object, prop: string | symbol) => {
      const v: unknown = Reflect.get(target, prop);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    };
    // the open-trade index refuses the write: the key was taken a moment ago
    const raced = new Proxy(t.db, { get: (target, prop) => (prop === "transaction" ? () => Promise.reject(new Error("insert failed", { cause: new Error('duplicate key value violates unique constraint "strategies_autopilot_open_uq"') })) : bound(target, prop)) });
    const warned: object[] = [];
    const logger = { info: () => undefined, warn: (o: object) => void warned.push(o) };
    const pass = await runAutopilot(deps(at + MIN, { db: raced, logger }), ["delta_india"]);
    expect(pass.entered).toBe(0);
    expect(warned.filter((w) => JSON.stringify(w).includes(userId))).toHaveLength(0);
    // the third read of a pass is the first underlying's exchange lookup: it fails, the pass goes on to the next underlying
    let reads = 0;
    const broken = new Proxy(t.db, {
      get(target, prop) {
        if (prop === "select" && ++reads === 3) throw new Error("the read failed");
        return bound(target, prop);
      },
    });
    const after = await runAutopilot(deps(at + 2 * MIN, { db: broken, logger }), ["delta_india"]);
    expect(after.failed).toBe(1);
    expect(warned.at(-1)).toMatchObject({ venue: "delta_india", asset: "BTC", reason: "the read failed" });
    // a log line older than the retention is dropped by the next pass
    await t.db.insert(autopilotRuns).values({ userId, playbookId: BUTTERFLY, venue: "delta_india", asset: "BTC", kind: "skipped", reason: "ancient", at: new Date(at - (AUTOPILOT_RUNS_RETENTION_DAYS + 1) * DAY) });
    await runAutopilot(deps(at + 3 * MIN), ["delta_india"]);
    expect((await t.db.select().from(autopilotRuns).where(eq(autopilotRuns.reason, "ancient"))).length).toBe(0);
  });
});

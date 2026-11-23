import type { Broker, Strategy, StrategyLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "@hapiecoin/pricing";
import { toPricingLegs } from "@/lib/pricing/legs";
import { heldWorstLoss, marginEstimate, withBooked } from "./analysis";
import type { StrategyLeg as LocalLeg } from "./legs";
import { bookedOf, bookedPnl, coverOf, dayPnl, daysOf, feeFor, feesOf, heldOf, legPnl, localLegToInput, pickToInput, pnlSeries, priceMap, serverLegToLocal, sourceOf, strategyPnl, summaryOf } from "./paper";

const BROKER: Broker = { id: "brk", name: "Delta Exchange India", feePct: "0.05", gstPct: "18", feeCapPct: "10", scope: "GLOBAL", venue: "delta_india" };
const leg = (over: Partial<StrategyLeg> = {}): StrategyLeg => ({
  id: "leg_1",
  kind: "call",
  side: "buy",
  strike: "80000",
  expiry: "2026-09-25",
  symbol: "C-BTC-80000-250926",
  lots: 10,
  price: "1200",
  entryPrice: "1200",
  exitPrice: null,
  iv: 0.5,
  status: "open",
  isAdjustment: false,
  position: 0,
  openedAt: "2026-09-08T10:00:00Z",
  closedAt: null,
  orderId: null,
  ...over,
});
const strat = (over: Partial<Strategy> = {}): Strategy => ({
  id: "strat_1",
  name: "Test",
  venue: "delta_india",
  asset: "BTC",
  status: "paper",
  tradingMode: "paper",
  templateName: "Custom",
  brokerId: "brk",
  legs: [leg()],
  realizedPnl: "0",
  pnlHistory: [],
  notes: "",
  tags: [],
  orderBatchId: null,
  orders: [],
  adjustments: [],
  startedAt: "2026-09-01T10:00:00Z",
  closedAt: null,
  createdAt: "2026-09-01T09:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  ...over,
});

describe("HC-TR-019 / HC-TR-052 fee estimate", () => {
  it("charges fee % of notional, caps options at cap % of premium, adds GST, and never caps futures", () => {
    // option: notional 80,000 × 0.01 = 800 → 0.05 % = 0.40; cap = 1200 × 0.01 × 10 % = 1.20 → fee 0.40, GST 18 % = 0.072
    const f = feeFor([{ id: "a", kind: "call", lots: 10, price: "1200" }], 80_000, "0.001", BROKER);
    expect(f.fee).toBeCloseTo(0.4, 6);
    expect(f.gst).toBeCloseTo(0.072, 6);
    expect(f.total).toBeCloseTo(0.472, 6);
    // cheap option: premium 10 × 0.01 = 0.10 → cap 0.01 beats the 0.40 notional fee
    expect(feeFor([{ id: "b", kind: "put", lots: 10, price: "10" }], 80_000, "0.001", BROKER).fee).toBeCloseTo(0.01, 6);
    // future: no cap
    expect(feeFor([{ id: "c", kind: "future", lots: 10, price: "10" }], 80_000, "0.001", BROKER).fee).toBeCloseTo(0.4, 6);
    expect(feeFor([{ id: "a", kind: "call", lots: 10, price: "1200" }], 80_000, "0.001", undefined).total).toBe(0);
  });
});

describe("HC-TR-061 / HC-TR-073 P&L", () => {
  it("prices open legs at the current mark and closed legs at their exit, with the side sign", () => {
    expect(legPnl(leg(), 1300, "0.001").pnl).toBeCloseTo(1, 9); // (1300−1200) × 10 × 0.001
    expect(legPnl(leg({ side: "sell" }), 1300, "0.001").pnl).toBeCloseTo(-1, 9);
    expect(legPnl(leg({ status: "squared_off", exitPrice: "1100" }), 9999, "0.001").pnl).toBeCloseTo(-1, 9);
    expect(legPnl(leg(), null, "0.001").pnl).toBe(0); // no quote yet → flat at entry
    const s = strat({ legs: [leg(), leg({ id: "leg_2", status: "squared_off", exitPrice: "1100" })], realizedPnl: "-1" });
    const p = strategyPnl(s, () => 1300, "0.001");
    expect(p.unrealized).toBeCloseTo(1, 9);
    expect(p.realized).toBe(-1);
    expect(p.total).toBeCloseTo(0, 9);
    expect(p.openLegs).toBe(1);
    expect(p.byLeg.get("leg_2")?.closed).toBe(true);
  });
  it("day P&L, days, sparkline series", () => {
    const s = strat({ pnlHistory: [{ day: "2026-09-06", pnl: "5" }, { day: "2026-09-07", pnl: "8" }] });
    expect(dayPnl(s, 10, "2026-09-08")).toBe(2);
    expect(dayPnl(strat(), 10, "2026-09-08")).toBe(10);
    expect(daysOf(s, Date.UTC(2026, 8, 8, 12))).toBe(7);
    expect(daysOf(strat({ startedAt: null }))).toBe(0);
    expect(daysOf(strat({ closedAt: "2026-09-03T10:00:00Z" }))).toBe(2);
    expect(pnlSeries(s, 10)).toEqual([5, 8, 10]);
    expect(pnlSeries(strat(), 3)).toEqual([0, 3]);
  });
});

describe("leg converters", () => {
  it("round-trips server legs through the Builder shape and builds API inputs from chain picks", () => {
    const local = serverLegToLocal(leg({ entryPrice: "1250" }), "BTC");
    expect(local).toMatchObject({ id: "leg_1", asset: "BTC", kind: "call", price: "1250", iv: 0.5, status: "open" });
    expect(localLegToInput({ ...local, kind: "future", expiry: "PERP", strike: "", symbol: "BTCUSD" })).toMatchObject({ kind: "future", strike: "", expiry: "PERP", symbol: "BTCUSD" });
    expect(localLegToInput(local)).toMatchObject({ kind: "call", strike: "80000", expiry: "2026-09-25", iv: 0.5 });
    expect(pickToInput({ asset: "BTC", kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", lots: 3, price: "900.123456" })).toEqual({ kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 3, price: "900.1235" });
    expect(priceMap([leg(), leg({ id: "leg_2" })], (l) => (l.id === "leg_1" ? 1300.55555 : null))).toEqual({ leg_1: "1300.5556", leg_2: "1200" });
  });
});

describe("HC-TR-156 / HC-TR-157 expiry and lifecycle helpers", () => {
  it("expiryOf reads the open option legs; daysLeft honours the settlement hour; lifecycleOf classifies", async () => {
    const { daysLeft, expiryOf, lifecycleOf } = await import("./paper");
    const now = Date.parse("2026-09-10T08:00:00Z");
    expect(daysLeft("2026-09-10", now)).toBe(0.2);
    expect(daysLeft("2026-09-10", now, 16)).toBe(0.3);
    expect(daysLeft("2026-09-09", now)).toBe(0);
    expect(daysLeft("nonsense", now)).toBe(0);
    const leg = (over: Record<string, unknown>) => ({ id: "l", kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 1, price: "1", entryPrice: "1", exitPrice: null, iv: 0.5, status: "open", isAdjustment: false, position: 0, openedAt: "2026-09-01T00:00:00Z", closedAt: null, orderId: null, ...over });
    const strat = (legs: unknown[], over: Record<string, unknown> = {}) => ({ id: "s", name: "s", asset: "BTC", status: "paper", tradingMode: "paper", templateName: "", brokerId: null, legs, realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: null, closedAt: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...over }) as unknown as Parameters<typeof expiryOf>[0];
    expect(expiryOf(strat([leg({}), leg({ id: "m", expiry: "2026-09-10" }), leg({ id: "f", kind: "future", expiry: "2026-09-01" }), leg({ id: "c", expiry: "2026-09-05", status: "squared_off" })]))).toEqual({ nearest: "2026-09-10", latest: "2026-09-25" });
    expect(expiryOf(strat([leg({ id: "f", kind: "future" })]))).toBeNull();
    expect(lifecycleOf(strat([leg({})]), now)).toBe("open");
    expect(lifecycleOf(strat([leg({ expiry: "2026-09-10" })]), now)).toBe("expiring");
    // XAUT settles at 16:00 UTC: at 14:00 the day before that is 26 h (1.1 d, open); BTC's 12:00 would be 22 h (0.9 d, expiring)
    expect(lifecycleOf(strat([leg({ expiry: "2026-09-10" })], { asset: "XAUT" }), Date.parse("2026-09-09T14:00:00Z"))).toBe("open");
    expect(lifecycleOf(strat([leg({ expiry: "2026-09-10" })]), Date.parse("2026-09-09T14:00:00Z"))).toBe("expiring");
    expect(lifecycleOf(strat([leg({})], { status: "archived" }), now)).toBe("closed");
  });
});

describe("HC-TR-250 / HC-TR-252 who opened a trade, how long it was held, and a set added up", () => {
  it("HC-TR-250 a trade with a playbook was opened by Autopilot, any other by the trader", () => {
    expect(sourceOf(strat({ autopilotPlaybookId: "evening-strangle-stop-3x" }))).toBe("autopilot");
    expect(sourceOf(strat({ autopilotPlaybookId: null }))).toBe("manual");
    expect(sourceOf(strat())).toBe("manual");
  });
  it("HC-TR-252 the time held reads in minutes, then hours and minutes, then days and hours", () => {
    const start = Date.UTC(2026, 8, 1, 10); // strat() starts 1 Sep 10:00 UTC
    expect(heldOf(strat(), start + 42 * 60_000)).toBe("42 m");
    expect(heldOf(strat(), start + 59 * 60_000 + 59_000)).toBe("59 m");
    expect(heldOf(strat(), start + 60 * 60_000)).toBe("1 h 0 m");
    expect(heldOf(strat({ closedAt: "2026-09-01T21:16:30Z" }))).toBe("11 h 16 m"); // a closed trade stops at its exit, whatever the clock says
    expect(heldOf(strat(), start + (47 * 60 + 59) * 60_000)).toBe("47 h 59 m");
    expect(heldOf(strat(), start + 48 * 3_600_000)).toBe("2 d 0 h");
    expect(heldOf(strat({ closedAt: "2026-09-04T14:30:00Z" }))).toBe("3 d 4 h");
    expect(heldOf(strat({ startedAt: null }))).toBeNull();
    expect(heldOf(strat({ startedAt: "not a date" }))).toBeNull();
    expect(heldOf(strat(), start - 5 * 60_000)).toBe("0 m"); // a clock behind the entry never reads negative
  });
  it("HC-TR-252 a set of trades adds up: how many, how many above zero, and the total", () => {
    const rows = [strat({ id: "a", realizedPnl: "10" }), strat({ id: "b", realizedPnl: "-4" }), strat({ id: "c", realizedPnl: "0" })];
    expect(summaryOf(rows, (x) => Number(x.realizedPnl))).toEqual({ trades: 3, won: 1, total: 6, fees: 0, net: 6 });
    expect(summaryOf([], () => 1)).toEqual({ trades: 0, won: 0, total: 0, fees: 0, net: 0 });
  });
  it("HC-TR-254 with fees a set gives what is left, and a trade that made less than its fees has not won", () => {
    const rows = [strat({ id: "a", realizedPnl: "10" }), strat({ id: "b", realizedPnl: "1" }), strat({ id: "c", realizedPnl: "-4" }), strat({ id: "d", realizedPnl: "3" })];
    const fee = (x: Strategy) => (x.id === "d" ? null : 2); // d: a venue with no fee rule counts as nothing owed
    expect(summaryOf(rows, (x) => Number(x.realizedPnl), fee)).toEqual({ trades: 4, won: 2, total: 10, fees: 6, net: 4 });
  });
  it("HC-TR-253 a trade's fees so far come from its legs under the venue's rule: entries, exits made, in-the-money settlements; none without a rule", () => {
    const RULE = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
    const fill = 80_000 * 0.01 * 0.0001 * 1.18; // 10 lots of 0.001 BTC at an 80 000 strike
    const open = strat({ legs: [leg({ lots: 10, entryPrice: "1200" })] });
    expect(feesOf(open, "0.001", RULE)!.total).toBeCloseTo(fill, 10);
    const bought = strat({ legs: [leg({ lots: 10, entryPrice: "1200", exitPrice: "1300", status: "squared_off", closeReason: "target" })] });
    expect(feesOf(bought, "0.001", RULE)!.entry).toBeCloseTo(fill, 10);
    expect(feesOf(bought, "0.001", RULE)!.exit).toBeCloseTo(fill, 10);
    const worthless = strat({ legs: [leg({ lots: 10, entryPrice: "1200", exitPrice: "0", status: "squared_off", closeReason: "expired" })] });
    expect(feesOf(worthless, "0.001", RULE)!.exit).toBe(0);
    const settled = strat({ legs: [leg({ lots: 10, entryPrice: "1200", exitPrice: "500", status: "squared_off", closeReason: "expired" })] });
    expect(feesOf(settled, "0.001", RULE)!.exit).toBeCloseTo(80_500 * 0.01 * 0.0001 * 1.18, 10); // settled 500 in the money, so the spot was 80 500; its cap (0.175) is above that
    const stale = strat({ legs: [leg({ lots: 10, entryPrice: "1200", exitPrice: "1300", status: "open" })] }); // an exit price on a leg still open is not an exit
    expect(feesOf(stale, "0.001", RULE)!.exit).toBe(0);
    const draft = strat({ legs: [leg({ lots: 10, entryPrice: null })] });
    expect(feesOf(draft, "0.001", RULE)).toEqual({ entry: 0, exit: 0, total: 0 });
    expect(feesOf(open, "0.001", null)).toBeNull();
  });
});

describe("HC-TR-255 whether a position's capital can be read as its worst loss", () => {
  const l = (kind: StrategyLeg["kind"], side: StrategyLeg["side"], lots = 10) => ({ kind, side, lots });
  it("HC-TR-255 covered only when every sold option has a bought one on its side; a sold put alone is not covered; any future is margined", () => {
    expect(coverOf([l("call", "buy")])).toBe("covered");
    expect(coverOf([l("put", "buy"), l("put", "sell"), l("call", "sell"), l("call", "buy")])).toBe("covered"); // a condor
    expect(coverOf([l("call", "sell")])).toBe("uncovered");
    expect(coverOf([l("put", "sell")])).toBe("uncovered"); // its loss to a price of zero is finite, and is not what it ties up
    expect(coverOf([l("put", "sell"), l("call", "sell")])).toBe("uncovered"); // a strangle
    expect(coverOf([l("call", "sell", 20), l("call", "buy", 10)])).toBe("uncovered"); // half covered
    expect(coverOf([l("call", "sell"), l("put", "buy")])).toBe("uncovered"); // a put does not cover a call
    expect(coverOf([l("future", "buy"), l("call", "sell")])).toBe("futures");
    expect(coverOf([])).toBe("covered");
  });
});

describe("HC-TR-260 the result a running trade has already booked, priced with its open legs (ADR-131)", () => {
  const S = { id: "strat_w", asset: "BTC" as const, status: "paper" as const, realizedPnl: "-205.34" };
  // the owner's trade of 23 Nov 2026: a weekly strangle whose call was stopped for a loss of 205.34 USD, the put (sold at 1,111.3, 100 lots) still open
  const PUT: LocalLeg = { id: "leg_p", asset: "BTC", kind: "put", side: "sell", strike: "58500", expiry: "2026-11-27", lots: 100, price: "1111.3", symbol: "P-BTC-58500-271126", status: "open", createdAt: 0 };
  const opts = { spot: 61_000, nowMs: Date.UTC(2026, 10, 23, 15), defaultIv: 0.5 };

  it("HC-TR-260 nothing booked, a trade that is not running, a figure that is not a number or no lot size: no pair and no amount", () => {
    expect(bookedPnl(S)).toBe(-205.34);
    expect(bookedPnl({ status: "live", realizedPnl: "12.5" })).toBe(12.5);
    expect(bookedPnl({ status: "paper", realizedPnl: "0" })).toBe(0);
    expect(bookedPnl({ status: "paper", realizedPnl: "0.004" })).toBe(0); // under half a cent is nothing
    expect(bookedPnl({ status: "archived", realizedPnl: "-205.34" })).toBe(0); // a closed trade is read on its own legs
    expect(bookedPnl({ status: "draft", realizedPnl: "5" })).toBe(0);
    expect(bookedPnl({ status: "paper", realizedPnl: "n/a" })).toBe(0);
    for (const none of [bookedOf({ ...S, realizedPnl: "0" }, "0.001"), bookedOf({ ...S, status: "archived" }, "0.001"), bookedOf(S, undefined), bookedOf(S, "0"), bookedOf(S, "x")]) expect(none).toEqual({ amount: 0, legs: [] });
  });

  it("HC-TR-260 the pair is worth the booked result at every price and on every date, a loss or a profit, and adds no delta", () => {
    for (const booked of ["-205.34", "50"]) {
      const { amount, legs } = bookedOf({ ...S, realizedPnl: booked }, "0.001");
      expect(amount).toBe(Number(booked));
      expect(legs.map((l) => `${l.kind} ${l.side} x${l.lots}`)).toEqual(["future buy x1", "future sell x1"]);
      expect(legs.every((l) => Number(l.price) > 0)).toBe(true);
      const r = analyze(toPricingLegs(legs, "0.001"), opts);
      for (const pt of r.points) {
        expect(pt.pnlExpiry).toBeCloseTo(amount, 6);
        expect(pt.pnlTarget).toBeCloseTo(amount, 6);
      }
      expect(r.greeks.delta).toBeCloseTo(0, 9);
      expect(r.greeks.theta).toBeCloseTo(0, 9);
    }
  });

  it("HC-TR-260 priced with the pair, the open put's figures become the whole trade's: no profit left to make, no break-even; its premium, its margin and its greeks stay the open put's", () => {
    const { amount, legs } = bookedOf(S, "0.001");
    const open = analyze(toPricingLegs([PUT], "0.001"), opts);
    const whole = withBooked(analyze(toPricingLegs([PUT, ...legs], "0.001"), opts), amount);
    // the put alone: its premium is the most it makes. The whole trade: that premium less the call's loss
    expect(open.maxProfit).toBeCloseTo(111.13, 6);
    expect(whole.maxProfit).toBeCloseTo(111.13 - 205.34, 6);
    expect(whole.maxLoss).toBeCloseTo(open.maxLoss - 205.34, 6);
    expect(open.breakevens.map((b) => Math.round(b))).toEqual([57_389]);
    expect(whole.breakevens).toEqual([]);
    expect(open.pop).toBeGreaterThan(0.5);
    expect(whole.pop).toBe(0);
    expect(whole.booked).toBe(-205.34);
    // what is not the payoff stays what is held
    expect(whole.netPremium).toBeCloseTo(open.netPremium, 6);
    expect(marginEstimate(whole)).toBeCloseTo(marginEstimate(open)!, 6);
    expect(whole.greeks.delta).toBeCloseTo(open.greeks.delta, 9);
    expect(whole.greeks.theta).toBeCloseTo(open.greeks.theta, 9);
    // what is sent to a venue's balance check is the held legs' worst loss, never the realised part on top (or taken off)
    expect(heldWorstLoss(whole)).toBeCloseTo(open.maxLoss, 6);
    expect(heldWorstLoss(open)).toBe(open.maxLoss);
    const profit = bookedOf({ ...S, realizedPnl: "50" }, "0.001");
    expect(heldWorstLoss(withBooked(analyze(toPricingLegs([PUT, ...profit.legs], "0.001"), opts), profit.amount))).toBeCloseTo(open.maxLoss, 6);
    expect(heldWorstLoss(null)).toBeNull();
    expect(heldWorstLoss({ ...open, maxLoss: -Infinity })).toBeNull();
    // nothing booked: the same object back, untouched
    expect(withBooked(open, 0)).toBe(open);
  });
});

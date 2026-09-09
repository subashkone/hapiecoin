// Whale tracking maths (HC-MA-067..071, ADR-043): position diffs, wall tracking and the tracker's poll sets.
import type { LargeOrder, WhalePosition } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { WhaleTracker, diffPositions, hourOf, mergeWalls, wallsFrom } from "./whales.js";

const pos = (over: Partial<WhalePosition>): WhalePosition => ({ wallet: "w1", coin: "BTC", side: "long", size: 10, notionalUsd: 800_000, entryPx: 80_000, markPx: null, liquidationPx: null, unrealizedPnl: 0, leverage: 5, leverageType: "cross", marginUsed: 160_000, ...over });
const NOW = 1_788_900_000_000;

describe("[INGEST] whales maths", () => {
  it("turns position changes into alerts above the threshold, only for polled wallets", () => {
    const prev = new Map<string, WhalePosition[]>([
      ["w1", [pos({ notionalUsd: 5e6 }), pos({ coin: "ETH", notionalUsd: 2e6 }), pos({ coin: "SOL", notionalUsd: 3e6, side: "short" })]],
      ["w2", [pos({ wallet: "w2", notionalUsd: 9e6 })]],
      ["w3", [pos({ wallet: "w3", notionalUsd: 9e6 })]],
      ["w4", [pos({ wallet: "w4", coin: "DOGE", side: "short", notionalUsd: 0.3e6 }), pos({ wallet: "w4", coin: "LTC", notionalUsd: 5e6 })]],
    ]);
    const next = new Map<string, WhalePosition[]>([
      ["w1", [pos({ notionalUsd: 7.5e6 }), pos({ coin: "ETH", notionalUsd: 0.8e6 }), pos({ coin: "SOL", notionalUsd: 4e6, side: "long" }), pos({ coin: "DOGE", notionalUsd: 1.2e6 }), pos({ coin: "LINK", notionalUsd: 0.5e6 })]],
      ["w4", [pos({ wallet: "w4", coin: "DOGE", side: "long", notionalUsd: 0.2e6 }), pos({ wallet: "w4", coin: "LTC", notionalUsd: 5.1e6 })]],
      ["w2", []],
    ]);
    const alerts = diffPositions(prev, next, new Set(["w1", "w2", "w4"]), NOW, 1e6); // w4's tiny flip and nudge stay silent
    expect(alerts.map((a) => `${a.wallet}:${a.coin}:${a.action}:${a.changeUsd}`)).toEqual(["w2:BTC:closed:9000000", "w1:SOL:flipped:7000000", "w1:BTC:increased:2500000", "w1:ETH:reduced:1200000", "w1:DOGE:opened:1200000"]);
    expect(alerts[1]?.side).toBe("long");
    expect(alerts[0]?.positionUsd).toBe(0);
    expect(diffPositions(prev, next, new Set(["w3"]), NOW, 1e6).map((a) => a.action)).toEqual(["closed"]); // polled but absent from the reply = closed
    expect(diffPositions(prev, next, new Set(), NOW, 1e6)).toEqual([]); // not polled: nothing compared
  });
  it("finds walls above the threshold and carries first-seen across polls; gone walls linger then drop", () => {
    const book = { asks: [{ price: 100, qty: 20_000 }, { price: 101, qty: 1 }], bids: [{ price: 99, qty: 15_000 }], ts: NOW };
    const fresh = wallsFrom(book, "BTC", "bybit", NOW, 1e6);
    expect(fresh.map((o) => `${o.side}@${o.price}=${o.usd}`)).toEqual(["bid@99=1485000", "ask@100=2000000"]);
    const merged = mergeWalls([], fresh, new Set(["BTC"]), NOW);
    expect(merged.map((o) => o.usd)).toEqual([2_000_000, 1_485_000]);
    const later = mergeWalls(merged, wallsFrom({ ...book, bids: [] }, "BTC", "bybit", NOW + 60_000, 1e6), new Set(["BTC"]), NOW + 60_000);
    expect(later.find((o) => o.side === "ask")).toMatchObject({ firstSeen: NOW, lastSeen: NOW + 60_000, resting: true });
    expect(later.find((o) => o.side === "bid")).toMatchObject({ firstSeen: NOW, lastSeen: NOW, resting: false });
    const other: LargeOrder = { venue: "bybit", symbol: "ETH", side: "bid", price: 1, qty: 1e6, usd: 1e6, firstSeen: NOW, lastSeen: NOW, resting: true };
    const unpolled = mergeWalls([...later, other], [], new Set(["BTC"]), NOW + 32 * 60_000);
    expect(unpolled.map((o) => `${o.symbol}:${o.resting}`)).toEqual(["ETH:true"]); // ETH not polled: untouched; BTC walls gone > 30 min: dropped
    expect(hourOf(NOW)).toBe(Math.floor(NOW / 3_600_000) * 3_600_000);
  });
  it("tracker: poll sets, alert ring, hourly accumulation, open positions with marks and wallet counts", () => {
    const t = new WhaleTracker({ alertMinUsd: 1e6, wallMinUsd: 1e6, maxAlerts: 2, maxPositions: 2 });
    t.candidates = ["a", "b"];
    expect(t.pollSet(true, ["z"])).toEqual(["z", "a", "b"]);
    expect(t.pollSet(false, ["z"])).toEqual(["z"]);
    const alerts = t.apply(new Map([["a", [pos({ wallet: "a", notionalUsd: 2e6 }), pos({ wallet: "a", coin: "ETH", notionalUsd: 1.5e6 }), pos({ wallet: "a", coin: "SOL", notionalUsd: 1.2e6 })]], ["b", []]]), new Set(["a", "b"]), NOW);
    expect(alerts).toHaveLength(3);
    expect(t.alerts).toHaveLength(2); // ring capped
    expect(t.hour).toEqual({ t: hourOf(NOW), v: 4.7e6 });
    expect(t.pollSet(false, [])).toEqual(["a"]);
    expect(t.walletsWithPositions()).toBe(1);
    const open = t.openPositions(new Map([["BTC", 81_000]]));
    expect(open).toHaveLength(2);
    expect(open[0]).toMatchObject({ coin: "BTC", markPx: 81_000 });
    expect(open[1]?.markPx).toBeNull();
    t.apply(new Map([["a", []]]), new Set(["a"]), NOW + 3_600_000);
    expect(t.hour).toEqual({ t: hourOf(NOW + 3_600_000), v: 4.7e6 }); // new hour starts from the closes
    t.apply(new Map(), new Set(["c"]), NOW + 3_600_000); // polled but absent from the reply: recorded as empty
    expect(t.positions.get("c")).toEqual([]);
    expect(new WhaleTracker().opts.alertMinUsd).toBe(1_000_000);
  });
});

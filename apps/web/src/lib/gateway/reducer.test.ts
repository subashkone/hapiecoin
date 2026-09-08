import type { ChainRow, ServerMessage } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { buildChain, strikesOf } from "../../../test/fixtures/chain";
import {
  applyDeltas,
  applyServerMessage,
  applySnapshot,
  applySpot,
  atmIndex,
  emptyChain,
  flashDirection,
  SPOT_HISTORY,
} from "./reducer";

const TOPIC = "chain:delta_india:BTC:2026-09-25";
const rows: ChainRow[] = buildChain("BTC", "2026-09-25");
const both = rows.findIndex((r) => r.call && r.put);

describe("HC-WS-108 chain reducer keeps the venue strike list", () => {
  it("applySnapshot replaces rows and indexes every instrument", () => {
    const s = applySnapshot(emptyChain(TOPIC), 7, rows, 1000);
    expect(s.seq).toBe(7);
    expect(s.rows.map((r) => r.strike)).toEqual(strikesOf("BTC", "2026-09-25"));
    expect(s.rows).toHaveLength(52);
    expect(both).toBeGreaterThanOrEqual(0);
    expect(s.index.get(rows[both]!.call!.instrumentId)).toEqual({ row: both, side: "call" });
    expect(s.index.get(rows[both]!.put!.instrumentId)).toEqual({ row: both, side: "put" });
    expect(s.updatedAt).toBe(1000);
    expect(s.stale).toBe(false);
  });
  it("applyDeltas patches only the changed fields and records them for flashing", () => {
    const s0 = applySnapshot(emptyChain(TOPIC), 0, rows, 1);
    const target = rows[10]!.call!;
    const s1 = applyDeltas(s0, 1, [{ i: target.instrumentId, mark: "999.5", ts: 2 }], 2);
    expect(s1.seq).toBe(1);
    expect(s1.rows[10]!.call!.mark).toBe("999.5");
    expect(s1.rows[10]!.call!.bid).toBe(target.bid); // untouched
    expect(s1.rows[10]!.put).toBe(rows[10]!.put); // other side reference preserved
    expect([...s1.changed.get(target.instrumentId)!]).toEqual(expect.arrayContaining(["mark", "ts"]));
    expect(s1.rows).not.toBe(s0.rows);
    expect(s1.rows[11]).toBe(s0.rows[11]); // untouched rows keep identity
  });
  it("ignores deltas for unknown instruments and unchanged values", () => {
    const s0 = applySnapshot(emptyChain(TOPIC), 0, rows, 1);
    const same = rows[3]!.put!;
    const s1 = applyDeltas(s0, 1, [{ i: "delta_india:C-BTC-1-250926", mark: "1" }, { i: same.instrumentId, mark: same.mark }], 2);
    expect(s1.seq).toBe(1);
    expect(s1.changed.size).toBe(0);
  });
  it("marks the state stale on a sequence gap and ignores deltas before a snapshot", () => {
    const s0 = applySnapshot(emptyChain(TOPIC), 5, rows, 1);
    const gap = applyDeltas(s0, 7, [{ i: rows[0]!.call!.instrumentId, mark: "1" }]);
    expect(gap.stale).toBe(true);
    expect(gap.seq).toBe(5);
    // GAPS #30: a replayed or out-of-order frame is ignored rather than marking the chain stale
    const replay = applyDeltas(s0, 5, [{ i: rows[0]!.call!.instrumentId, mark: "1" }]);
    expect(replay).toBe(s0);
    expect(applyDeltas(s0, 3, []).stale).toBe(false);
    const none = applyDeltas(emptyChain(TOPIC), 1, [{ i: rows[0]!.call!.instrumentId, mark: "1" }]);
    expect(none.seq).toBe(-1);
  });
  it("applyServerMessage routes snap/q for its topic and ignores the rest", () => {
    const s0 = emptyChain(TOPIC);
    const snap: ServerMessage = { t: "snap", topic: TOPIC, seq: 0, rows };
    const s1 = applyServerMessage(s0, snap, 1);
    expect(s1.rows).toHaveLength(52);
    const other: ServerMessage = { t: "snap", topic: "chain:delta_india:ETH:2026-09-25", seq: 0, rows: [] };
    expect(applyServerMessage(s1, other)).toBe(s1);
    const q: ServerMessage = { t: "q", topic: TOPIC, seq: 1, d: [{ i: rows[1]!.call!.instrumentId, ask: "5" }] };
    expect(applyServerMessage(s1, q).rows[1]!.call!.ask).toBe("5");
    expect(applyServerMessage(s1, { t: "pong" })).toBe(s1);
    expect(applyServerMessage(s1, { t: "spot", s: "BTC", p: "1" })).toBe(s1);
  });
});

describe("HC-SH-004 flashDirection / atmIndex / applySpot", () => {
  it("flashDirection compares decimal strings numerically", () => {
    expect(flashDirection("1.0", "1.5")).toBe("up");
    expect(flashDirection("2", "1.5")).toBe("down");
    expect(flashDirection("1.0", "1.00")).toBeNull();
    expect(flashDirection(undefined, "1")).toBeNull();
    expect(flashDirection("x", "1")).toBeNull();
  });
  it("atmIndex picks the strike bracketing spot", () => {
    const list = [{ strike: "79000" }, { strike: "79500" }, { strike: "80000" }];
    expect(atmIndex(list, "79521")).toBe(1);
    expect(atmIndex(list, "80000")).toBe(2);
    expect(atmIndex(list, "70000")).toBe(0);
    expect(atmIndex(list, undefined)).toBe(-1);
    expect(atmIndex([], "1")).toBe(-1);
    expect(atmIndex(list, "abc")).toBe(-1);
  });
  it("applySpot tracks prev, direction, session high/low and a bounded history", () => {
    let s = applySpot(undefined, "100", -1.5, 1);
    expect(s).toMatchObject({ price: "100", prev: undefined, c24: -1.5, dir: null, high: "100", low: "100" });
    s = applySpot(s, "101", undefined, 2);
    expect(s).toMatchObject({ prev: "100", dir: "up", c24: -1.5, high: "101", low: "100" });
    s = applySpot(s, "99", 0.2, 3);
    expect(s).toMatchObject({ dir: "down", high: "101", low: "99", c24: 0.2 });
    for (let i = 0; i < SPOT_HISTORY + 5; i++) s = applySpot(s, String(100 + i), 0, 10 + i);
    expect(s.history).toHaveLength(SPOT_HISTORY);
    expect(s.history[s.history.length - 1]).toBe(String(100 + SPOT_HISTORY + 4));
  });
});

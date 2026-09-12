import { describe, expect, it } from "vitest";
import { ClientMessage, MAX_TOPICS_PER_MESSAGE, QuoteDelta, Seq, ServerMessage, Topic, canonicalTopic, chainTopic, futTopic, parseTopic, spotTopic } from "./gateway.js";

describe("HC-WS-009 Topic patterns", () => {
  it.each([
    "chain:delta_india:BTC:2026-09-25",
    "chain:delta_india:XAUT:2026-09-11",
    "spot:BTC",
    "spot:ETH",
    "spot:deribit:BTC",
    "spot:delta_india:XAUT",
    "fut:delta_india:BTCUSD",
    "fut:delta_india:ETHUSD-250926",
  ])("accepts %s", (t) => {
    expect(Topic.safeParse(t).success).toBe(true);
  });
  it.each([
    "",
    "chain",
    "chain:delta_india:BTC",
    "chain:delta_india:BTC:25SEP26",
    "chain:delta_india:SOL:2026-09-25",
    "chain:binance:BTC:2026-09-25",
    "chain:delta_india:btc:2026-09-25",
    "spot:",
    "spot:SOL",
    "spot:BTC:extra",
    "spot:okx:BTC",
    "spot:deribit:SOL",
    "spot:deribit:",
    "fut:delta_india:",
    "fut:delta_india:BTC USD",
    "fut:binance:BTCUSDT",
    "ticker:BTC",
    "CHAIN:delta_india:BTC:2026-09-25",
  ])("rejects %s", (t) => {
    expect(Topic.safeParse(t).success).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(Topic.safeParse(42).success).toBe(false);
  });
  it("builders produce valid topics", () => {
    expect(Topic.parse(chainTopic("delta_india", "BTC", "2026-09-25"))).toBe("chain:delta_india:BTC:2026-09-25");
    expect(Topic.parse(spotTopic("ETH"))).toBe("spot:ETH");
    expect(Topic.parse(spotTopic("ETH", "deribit"))).toBe("spot:deribit:ETH"); // HC-SH-126 / ADR-071
    expect(canonicalTopic("spot:ETH")).toBe("spot:delta_india:ETH");
    expect(canonicalTopic("spot:deribit:ETH")).toBe("spot:deribit:ETH");
    expect(canonicalTopic("chain:delta_india:BTC:2026-09-25")).toBe("chain:delta_india:BTC:2026-09-25");
    expect(Topic.parse(futTopic("delta_india", "BTCUSD"))).toBe("fut:delta_india:BTCUSD");
  });
  it("parseTopic splits every pattern and returns null otherwise", () => {
    expect(parseTopic("chain:delta_india:BTC:2026-09-25")).toEqual({
      kind: "chain",
      venue: "delta_india",
      underlying: "BTC",
      expiry: "2026-09-25",
    });
    expect(parseTopic("spot:XAUT")).toEqual({ kind: "spot", venue: "delta_india", underlying: "XAUT" }); // the bare form is the default venue's
    expect(parseTopic("spot:deribit:BTC")).toEqual({ kind: "spot", venue: "deribit", underlying: "BTC" });
    expect(parseTopic("fut:delta_india:BTCUSD")).toEqual({ kind: "fut", venue: "delta_india", symbol: "BTCUSD" });
    expect(parseTopic("nope")).toBeNull();
  });
});

describe("HC-WS-009 ClientMessage", () => {
  it("accepts sub, unsub and ping", () => {
    expect(ClientMessage.safeParse({ op: "sub", topics: ["spot:BTC"] }).success).toBe(true);
    expect(ClientMessage.safeParse({ op: "unsub", topics: ["spot:BTC", "fut:delta_india:BTCUSD"] }).success).toBe(true);
    expect(ClientMessage.safeParse({ op: "ping" }).success).toBe(true);
  });
  it("rejects empty, oversized or invalid topic lists and unknown ops", () => {
    expect(ClientMessage.safeParse({ op: "sub", topics: [] }).success).toBe(false);
    expect(ClientMessage.safeParse({ op: "sub", topics: ["spot:SOL"] }).success).toBe(false);
    expect(ClientMessage.safeParse({ op: "sub" }).success).toBe(false);
    expect(
      ClientMessage.safeParse({ op: "sub", topics: Array.from({ length: MAX_TOPICS_PER_MESSAGE + 1 }, () => "spot:BTC") })
        .success,
    ).toBe(false);
    expect(ClientMessage.safeParse({ op: "subscribe", topics: ["spot:BTC"] }).success).toBe(false);
    expect(ClientMessage.safeParse({ op: "ping", topics: ["spot:BTC"] }).success).toBe(true);
    expect(ClientMessage.safeParse("ping").success).toBe(false);
  });
});

describe("HC-WS-009 QuoteDelta", () => {
  it("accepts an instrument id plus at least one changed field", () => {
    expect(QuoteDelta.safeParse({ i: "delta_india:BTCUSD", mark: "79521.5" }).success).toBe(true);
    expect(
      QuoteDelta.safeParse({
        i: "delta_india:C-BTC-80000-250926",
        ts: 1,
        bid: "1",
        ask: "2",
        markIv: 0.4,
        greeks: { delta: 0.5, gamma: 0, theta: 0, vega: 0 },
      }).success,
    ).toBe(true);
  });
  it("rejects a delta with no changed fields, a bad id, or a wrongly typed field", () => {
    expect(QuoteDelta.safeParse({ i: "delta_india:BTCUSD" }).success).toBe(false);
    expect(QuoteDelta.safeParse({ i: "BTCUSD", mark: "1" }).success).toBe(false);
    expect(QuoteDelta.safeParse({ i: "delta_india:BTCUSD", mark: 1 }).success).toBe(false);
    expect(QuoteDelta.safeParse({ instrumentId: "delta_india:BTCUSD", mark: "1" }).success).toBe(false);
  });
});

describe("HC-WS-009 ServerMessage", () => {
  const q = { instrumentId: "delta_india:C-BTC-80000-250926", ts: 1, mark: "1", oi: "0", spot: "79521" };
  it("accepts snap, q, spot, pong and err", () => {
    expect(
      ServerMessage.safeParse({
        t: "snap",
        topic: "chain:delta_india:BTC:2026-09-25",
        seq: 0,
        rows: [{ strike: "80000", call: q }],
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        t: "q",
        topic: "chain:delta_india:BTC:2026-09-25",
        seq: 7,
        d: [{ i: "delta_india:C-BTC-80000-250926", mark: "2" }],
      }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ t: "spot", s: "BTC", p: "79521.5", c24: -1.2 }).success).toBe(true);
    expect(ServerMessage.safeParse({ t: "spot", s: "ETH", p: "4200" }).success).toBe(true);
    expect(ServerMessage.safeParse({ t: "spot", s: "BTC", v: "deribit", p: "77000" }).success).toBe(true);
    expect(ServerMessage.safeParse({ t: "spot", s: "BTC", v: "okx", p: "77000" }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "pong" }).success).toBe(true);
    expect(ServerMessage.safeParse({ t: "err", code: "BAD_TOPIC", message: "unknown topic" }).success).toBe(true);
  });
  it("rejects unknown tags, missing fields, negative seq and unsorted-free but ill-typed rows", () => {
    expect(ServerMessage.safeParse({ t: "hello" }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "snap", topic: "spot:BTC", seq: -1, rows: [] }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "snap", topic: "bad", seq: 1, rows: [] }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "snap", topic: "spot:BTC", seq: 1, rows: [{ strike: 1 }] }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "q", topic: "spot:BTC", seq: 1, d: [] }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "spot", s: "SOL", p: "1" }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "spot", s: "BTC", p: 79521.5 }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "err", code: "", message: "x" }).success).toBe(false);
    expect(ServerMessage.safeParse({ t: "err", code: "X" }).success).toBe(false);
  });
  it("Seq is a non-negative integer", () => {
    expect(Seq.safeParse(0).success).toBe(true);
    expect(Seq.safeParse(1.5).success).toBe(false);
    expect(Seq.safeParse(-1).success).toBe(false);
  });
});

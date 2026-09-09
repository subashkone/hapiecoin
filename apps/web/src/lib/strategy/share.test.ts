import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, shareUrl } from "./share";

const legs = [
  { kind: "call" as const, side: "buy" as const, strike: "79500", expiry: "2026-09-25", lots: 10, price: "3060.6", iv: 0.4212 },
  { kind: "call" as const, side: "sell" as const, strike: "80500", expiry: "2026-09-25", lots: 10, price: "2596.4", iv: undefined },
  { kind: "future" as const, side: "sell" as const, strike: "", expiry: "PERP", lots: 5, price: "79521", iv: undefined },
];

describe("HC-WS-105 / HC-WS-106 share links", () => {
  it("round-trips asset, name and legs through a base64url code", () => {
    const code = encodeShare({ asset: "BTC", name: " Bull Call Spread ", legs });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const out = decodeShare(code)!;
    expect(out.asset).toBe("BTC");
    expect(out.name).toBe("Bull Call Spread");
    expect(out.legs).toHaveLength(3);
    expect(out.legs[0]).toEqual({ asset: "BTC", kind: "call", side: "buy", strike: "79500", expiry: "2026-09-25", lots: 10, price: "3060.6", iv: 0.4212 });
    expect(out.legs[1]!.iv).toBeUndefined();
    expect(out.legs[2]).toMatchObject({ kind: "future", strike: "", expiry: "PERP", lots: 5 });
    expect(shareUrl("https://hapiecoin.com", code)).toBe(`https://hapiecoin.com/s/${code}`);
  });
  it("rejects anything that is not a valid strategy", () => {
    expect(decodeShare("not base64!")).toBeNull();
    expect(decodeShare(btoa("[1,2,3]"))).toBeNull();
    const bad = (w: object) => decodeShare(btoa(JSON.stringify(w)).replace(/=+$/, ""));
    expect(bad({ v: 2, a: "BTC", l: [["call", "buy", "1", "2026-09-25", 1, "1"]] })).toBeNull(); // version
    expect(bad({ v: 1, a: "DOGE", l: [["call", "buy", "1", "2026-09-25", 1, "1"]] })).toBeNull(); // asset
    expect(bad({ v: 1, a: "BTC", l: [] })).toBeNull(); // no legs
    expect(bad({ v: 1, a: "BTC", l: [["swap", "buy", "1", "2026-09-25", 1, "1"]] })).toBeNull(); // kind
    expect(bad({ v: 1, a: "BTC", l: [["call", "buy", "1", "2026-09-25", 0, "1"]] })).toBeNull(); // lots
    expect(bad({ v: 1, a: "BTC", l: [["call", "buy", "1", "2026-09-25", 1, "abc"]] })).toBeNull(); // price
    expect(bad({ v: 1, a: "BTC", l: [["call", "buy", "1", "PERP", 1, "1"]] })).toBeNull(); // option on PERP
    expect(bad({ v: 1, a: "BTC", l: [["future", "buy", "5", "PERP", 1, "1"]] })).toBeNull(); // future with a strike
    expect(bad({ v: 1, a: "BTC", l: [["call", "buy", "1", "2026-09-25", 1, "1", 99]] })).toBeNull(); // iv
    expect(bad({ v: 1, a: "BTC", l: Array.from({ length: 11 }, () => ["call", "buy", "1", "2026-09-25", 1, "1"]) })).toBeNull(); // over the limit
    expect(bad({ v: 1, a: "BTC", n: 5, l: [["put", "sell", "1", "2026-09-25", 1, "1"]] })!.name).toBe(""); // a non-string name is dropped, not fatal
  });
});

import { QuoteDelta } from "@hapiecoin/schema";
import type { Quote } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { mergeDelta, quoteDelta } from "./diff.js";

const BASE: Quote = {
  instrumentId: "delta_india:C-BTC-80000-250926",
  ts: 1_788_543_685_911,
  mark: "1290.81008713",
  bid: "1247",
  ask: "1324",
  markIv: 0.42445466,
  bidIv: 0.41990933,
  askIv: 0.42807649,
  oi: "1014",
  volume24h: "0.957",
  bidQty: "6501",
  askQty: "4427",
  spot: "79521",
  greeks: { delta: 0.16426413, gamma: 0.00001532, theta: -23.86507888, vega: 94.28945667, rho: 27.02663566 },
};

describe("[GATEWAY] quote diff", () => {
  it("[GATEWAY] with no previous quote every present field is included and the delta validates", () => {
    const delta = quoteDelta(undefined, BASE);
    expect(delta).toEqual({ i: BASE.instrumentId, ...omit(BASE, "instrumentId") });
    expect(QuoteDelta.parse(delta)).toEqual(delta);
  });

  it("[GATEWAY] only changed fields are carried; unchanged ones are omitted", () => {
    const next: Quote = {
      ...BASE,
      ts: BASE.ts + 1000,
      mark: "1300",
      ask: "1330",
      greeks: { ...BASE.greeks!, delta: 0.17 },
    };
    const delta = quoteDelta(BASE, next);
    expect(delta).toEqual({
      i: BASE.instrumentId,
      ts: BASE.ts + 1000,
      mark: "1300",
      ask: "1330",
      greeks: next.greeks,
    });
    expect(QuoteDelta.parse(delta)).toEqual(delta);

    const sparse: Quote = { instrumentId: BASE.instrumentId, ts: 1, mark: "1", oi: "0", spot: "1" };
    expect(quoteDelta(undefined, sparse)).toEqual({
      i: BASE.instrumentId,
      ts: 1,
      mark: "1",
      oi: "0",
      spot: "1",
    });
    // a quote that gains greeks reports them; one that had none and still has none reports nothing about them
    expect(quoteDelta(sparse, { ...sparse, greeks: BASE.greeks! })).toEqual({
      i: BASE.instrumentId,
      greeks: BASE.greeks,
    });
    expect(quoteDelta(sparse, { ...sparse, ts: 2, mark: "2" })).toEqual({
      i: BASE.instrumentId,
      ts: 2,
      mark: "2",
    });
  });

  it("[GATEWAY] returns null when nothing changed or when only the venue timestamp moved", () => {
    expect(quoteDelta(BASE, { ...BASE })).toBeNull();
    expect(quoteDelta(BASE, { ...BASE, ts: BASE.ts + 5 })).toBeNull();
    expect(quoteDelta(BASE, { ...BASE, greeks: { ...BASE.greeks! } })).toBeNull();
    expect(quoteDelta(BASE, { ...BASE, ts: BASE.ts + 5, greeks: { ...BASE.greeks!, vega: 1 } })).toEqual({
      i: BASE.instrumentId,
      ts: BASE.ts + 5,
      greeks: { ...BASE.greeks!, vega: 1 },
    });
  });

  it("[GATEWAY] mergeDelta lets a later tick win field by field", () => {
    const earlier: QuoteDelta = { i: BASE.instrumentId, mark: "1", bid: "0.5" };
    const merged = mergeDelta(earlier, { i: BASE.instrumentId, mark: "2", ask: "3" });
    expect(merged).toBe(earlier);
    expect(merged).toEqual({ i: BASE.instrumentId, mark: "2", bid: "0.5", ask: "3" });
  });
});

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

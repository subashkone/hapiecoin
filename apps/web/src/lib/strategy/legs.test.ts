import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOTS,
  LOT_PRESETS,
  MAX_ACTIVE_LEGS,
  type StrategyLeg,
  addLeg,
  deltaSymbol,
  isLotPreset,
  legQuantity,
  legsForChain,
  normaliseLegs,
  removeLeg,
  rowMarks,
  stepLots,
} from "./legs";

const base = { asset: "BTC" as const, kind: "call" as const, side: "buy" as const, strike: "79400", expiry: "2026-09-07", lots: 10, price: "807.5", iv: 0.27 };

describe("HC-WS-025 stepLots walks the presets both ways and clamps", () => {
  it("steps through the presets and snaps odd values", () => {
    expect(LOT_PRESETS).toEqual([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]);
    expect(DEFAULT_LOTS).toBe(10);
    expect(stepLots(10, 1)).toBe(25);
    expect(stepLots(10, -1)).toBe(5);
    expect(stepLots(1, -1)).toBe(1);
    expect(stepLots(1000, 1)).toBe(1000);
    expect(stepLots(12, 1)).toBe(25);
    expect(stepLots(12, -1)).toBe(5);
    expect(isLotPreset(25)).toBe(true);
    expect(isLotPreset(3)).toBe(false);
    expect(isLotPreset("10")).toBe(false);
  });
});

describe("HC-WS-026 deltaSymbol formats the venue symbol", () => {
  it("uses C/P, the asset, an integral strike and DDMMYY", () => {
    expect(deltaSymbol("call", "BTC", "79400", "2026-09-07")).toBe("C-BTC-79400-070926");
    expect(deltaSymbol("put", "ETH", "4200.00", "2026-10-30")).toBe("P-ETH-4200-301026");
    expect(deltaSymbol("call", "XAUT", "3425.5", "2026-09-11")).toBe("C-XAUT-3425.5-110926");
    expect(deltaSymbol("call", "BTC", "80000", "bad")).toBe("C-BTC-80000-bad");
  });
});

describe("HC-TR-017 / HC-TR-018 addLeg, limits and chain filtering", () => {
  it("adds legs with a symbol and refuses the 11th active leg or bad lots", () => {
    let legs: StrategyLeg[] = [];
    const first = addLeg(legs, base, 1_700_000_000_000);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected ok");
    expect(first.leg.symbol).toBe("C-BTC-79400-070926");
    expect(first.leg.status).toBe("open");
    expect(first.leg.createdAt).toBe(1_700_000_000_000);
    legs = first.legs;
    for (let i = 1; i < MAX_ACTIVE_LEGS; i += 1) {
      const r = addLeg(legs, { ...base, strike: String(79_400 + i * 200) });
      if (!r.ok) throw new Error("expected ok");
      legs = r.legs;
    }
    expect(legs).toHaveLength(10);
    expect(addLeg(legs, base)).toEqual({ ok: false, reason: "limit" });
    expect(addLeg([], { ...base, lots: 0 })).toEqual({ ok: false, reason: "lots" });
    expect(addLeg([], { ...base, lots: 2.5 })).toEqual({ ok: false, reason: "lots" });
    const ids = new Set(legs.map((l) => l.id));
    expect(ids.size).toBe(10);
    expect(removeLeg(legs, legs[0]!.id)).toHaveLength(9);
  });
  it("legsForChain keeps only the asset and expiry of the chain", () => {
    const a = addLeg([], base);
    const b = addLeg(a.ok ? a.legs : [], { ...base, expiry: "2026-10-30" });
    const c = addLeg(b.ok ? b.legs : [], { ...base, asset: "ETH", strike: "4200" });
    const legs = c.ok ? c.legs : [];
    expect(legsForChain(legs, "BTC", "2026-09-07").map((l) => l.symbol)).toEqual(["C-BTC-79400-070926"]);
    expect(legsForChain(legs, "BTC", "2026-10-30")).toHaveLength(1);
    expect(legsForChain(legs, "ETH", "2026-09-07")).toHaveLength(1);
    expect(legsForChain(legs, "XAUT", "2026-09-07")).toHaveLength(0);
  });
});

describe("HC-WS-027 rowMarks totals lots per side and picks the stripe colour", () => {
  it("builds pills and tones", () => {
    let legs: StrategyLeg[] = [];
    for (const input of [
      base,
      { ...base, lots: 5 },
      { ...base, side: "sell" as const, kind: "put" as const, lots: 3 },
      { ...base, strike: "80000", side: "sell" as const },
    ]) {
      const r = addLeg(legs, input);
      if (!r.ok) throw new Error("expected ok");
      legs = r.legs;
    }
    const m = rowMarks(legs, "79400");
    expect(m.call).toEqual({ buyLots: 15, sellLots: 0, tone: "buy" });
    expect(m.put).toEqual({ buyLots: 0, sellLots: 3, tone: "sell" });
    expect(m.pills.map((p) => p.text)).toEqual(["C B 15", "P S 3"]);
    expect(m.pills[1]?.title).toBe("Short 3 lots put");
    const other = rowMarks(legs, "80000.00");
    expect(other.call.tone).toBe("sell");
    expect(other.pills.map((p) => p.text)).toEqual(["C S 10"]);
    expect(rowMarks(legs, "81000")).toEqual({ call: { buyLots: 0, sellLots: 0, tone: null }, put: { buyLots: 0, sellLots: 0, tone: null }, pills: [] });
  });
  it("legQuantity derives underlying units from lots × lot size at the lot size's precision (no float noise)", () => {
    expect(legQuantity(10, "0.001")).toBe("0.010");
    expect(legQuantity(7, "0.001")).toBe("0.007");
    expect(legQuantity(3, "0.1")).toBe("0.3");
    expect(legQuantity(25, "0.010")).toBe("0.25");
    expect(legQuantity(2, "1")).toBe("2");
    expect(legQuantity(10, undefined)).toBeNull();
    expect(legQuantity(10, "0")).toBeNull();
    expect(legQuantity(0, "0.001")).toBeNull();
  });
});

describe("normaliseLegs drops unknown shapes", () => {
  it("keeps valid legs and discards the rest", () => {
    const r = addLeg([], base);
    const good = r.ok ? r.leg : null;
    const out = normaliseLegs([good, { id: "x" }, null, "leg", { ...good, lots: -1 }, { ...good, asset: "DOGE" }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe("C-BTC-79400-070926");
    expect(normaliseLegs(undefined)).toEqual([]);
    expect(normaliseLegs({})).toEqual([]);
  });
});

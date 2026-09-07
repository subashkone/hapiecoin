import { describe, expect, it } from "vitest";
import {
  chainTotals,
  clampOffset,
  isChainRange,
  itmSide,
  maxOpenInterest,
  mirrorOffset,
  oiBarPercent,
  sliceAroundAtm,
} from "./range";

const rows = Array.from({ length: 41 }, (_, i) => ({ strike: String(70_000 + i * 500) }));

describe("HC-WS-016 sliceAroundAtm keeps exact venue strikes and centres the ATM", () => {
  it("keeps ±n rows around the ATM and reports the ATM position inside the slice", () => {
    const s = sliceAroundAtm(rows, 20, 6);
    expect(s.rows).toHaveLength(13);
    expect(s.offset).toBe(14);
    expect(s.atm).toBe(6);
    expect(s.rows[6]?.strike).toBe(rows[20]?.strike);
    expect(s.rows.map((r) => r.strike)).toEqual(rows.slice(14, 27).map((r) => r.strike));
  });
  it("clamps at the edges and returns everything for 'all' or when there is no ATM", () => {
    expect(sliceAroundAtm(rows, 2, 12)).toEqual({ rows: rows.slice(0, 15), offset: 0, atm: 2 });
    expect(sliceAroundAtm(rows, 40, 12).rows).toHaveLength(13);
    expect(sliceAroundAtm(rows, 20, 0).rows).toHaveLength(41);
    expect(sliceAroundAtm(rows, -1, 6)).toEqual({ rows, offset: 0, atm: -1 });
    expect(sliceAroundAtm(rows.slice(0, 5), 2, 12).rows).toHaveLength(5);
    expect(sliceAroundAtm([], -1, 6).rows).toEqual([]);
  });
  it("recognises the three range settings", () => {
    expect([6, 12, 0].every(isChainRange)).toBe(true);
    expect(isChainRange(3)).toBe(false);
    expect(isChainRange("6")).toBe(false);
  });
});

describe("HC-WS-020 itmSide marks calls below and puts above spot", () => {
  it("classifies strikes against spot", () => {
    expect(itmSide("79000", "79521")).toBe("call");
    expect(itmSide("80000", "79521")).toBe("put");
    expect(itmSide("79521", "79521")).toBeNull();
    expect(itmSide("79000", undefined)).toBeNull();
    expect(itmSide("abc", "79521")).toBeNull();
  });
});

describe("HC-WS-019 OI bars scale to the chain's largest open interest", () => {
  const quoted = [
    { strike: "1", call: { oi: "100" }, put: { oi: "400" } },
    { strike: "2", call: { oi: "250" }, put: undefined },
    { strike: "3", call: undefined, put: { oi: "bad" } },
  ];
  it("finds the max across both sides and converts each OI to a percent", () => {
    expect(maxOpenInterest(quoted)).toBe(400);
    expect(oiBarPercent("100", 400)).toBe(25);
    expect(oiBarPercent("400", 400)).toBe(100);
    expect(oiBarPercent("900", 400)).toBe(100);
    expect(oiBarPercent(undefined, 400)).toBe(0);
    expect(oiBarPercent("100", 0)).toBe(0);
    expect(oiBarPercent("0", 400)).toBe(0);
    expect(maxOpenInterest([])).toBe(0);
  });
  it("sums open interest per side and derives the put/call ratio", () => {
    expect(chainTotals(quoted)).toEqual({ callOi: 350, putOi: 400, pcr: 400 / 350 });
    expect(chainTotals([{ put: { oi: "5" } }])).toEqual({ callOi: 0, putOi: 5, pcr: null });
  });
});

describe("GAPS-2 mirrored horizontal offsets", () => {
  it("mirrors around the max offset and clamps", () => {
    expect(mirrorOffset(0, 120)).toBe(120);
    expect(mirrorOffset(120, 120)).toBe(0);
    expect(mirrorOffset(30, 120)).toBe(90);
    expect(mirrorOffset(500, 120)).toBe(0);
    expect(mirrorOffset(10, 0)).toBe(0);
    expect(clampOffset(-5, 100)).toBe(0);
    expect(clampOffset(150, 100)).toBe(100);
    expect(clampOffset(Number.NaN, 100)).toBe(0);
    expect(clampOffset(40, 0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { expectedMove, gammaExposure, impliedForward, maxPain, painProfile, putCallRatio, smile } from "./chain.js";
import type { ChainRow } from "./types.js";

const rows: ChainRow[] = [
  { strike: 110, callOi: 1, putOi: 10, callVolume: 3, putVolume: 1, callIv: 0.5, putIv: 0.52, callGamma: 1e-5, putGamma: 1.2e-5 },
  { strike: 90, callOi: 10, putOi: 1, callVolume: 1, putVolume: 3, callIv: 0.44, putIv: 0.46, callGamma: 1.1e-5, putGamma: 1e-5 },
  { strike: 100, callOi: 5, putOi: 5, callVolume: 2, putVolume: 2, callIv: 0.4, putIv: 0.41, callGamma: 2e-5, putGamma: 2e-5 },
];

describe("HC-WS-098 max pain", () => {
  it("HC-WS-098 pain per strike is Σ call OI × max(K − Ki, 0) + put OI × max(Ki − K, 0), sorted by strike", () => {
    expect(painProfile(rows)).toEqual([
      { strike: 90, pain: 250 },
      { strike: 100, pain: 200 },
      { strike: 110, pain: 250 },
    ]);
    expect(maxPain(rows)).toBe(100);
  });

  it("HC-WS-098 a tie resolves to the lower strike, missing OI counts as zero, an empty chain is NaN", () => {
    expect(maxPain([{ strike: 110, callOi: 1 }, { strike: 90, putOi: 1 }])).toBe(90);
    expect(maxPain([{ strike: 100, callOi: NaN, putOi: undefined }, { strike: 120, putOi: 2 }])).toBe(120);
    expect(maxPain([])).toBeNaN();
    expect(painProfile([])).toEqual([]);
  });
});

describe("HC-WS-029 put / call ratio and parity forward", () => {
  it("HC-WS-029 ratios on open interest (default) and on volume", () => {
    expect(putCallRatio(rows)).toBe(1);
    expect(putCallRatio(rows, "oi")).toBe(16 / 16);
    expect(putCallRatio(rows, "volume")).toBe(6 / 6);
    expect(putCallRatio([{ strike: 1, callOi: 4, putOi: 6 }])).toBe(1.5);
    expect(putCallRatio([{ strike: 1, callVolume: 4, putVolume: 1 }], "volume")).toBe(0.25);
  });

  it("HC-WS-029 no calls: Infinity with puts, NaN without either", () => {
    expect(putCallRatio([{ strike: 1, putOi: 3 }])).toBe(Infinity);
    expect(putCallRatio([{ strike: 1 }])).toBeNaN();
    expect(putCallRatio([])).toBeNaN();
  });

  it("HC-WS-029 forward from put-call parity is K + C − P", () => {
    expect(impliedForward(80_000, 2_500, 3_000)).toBe(79_500);
  });
});

describe("HC-WS-100 gamma exposure", () => {
  it("HC-WS-100 Σ γ × OI × lot × spot² × 1 % per strike, calls positive and puts negative", () => {
    const spot = 100;
    const lot = 0.001;
    const g = gammaExposure(rows, spot, lot);
    const scale = lot * spot * spot * 0.01;
    expect(g.byStrike).toEqual([
      { strike: 90, gex: (1.1e-5 * 10 - 1e-5 * 1) * scale },
      { strike: 100, gex: (2e-5 * 5 - 2e-5 * 5) * scale },
      { strike: 110, gex: (1e-5 * 1 - 1.2e-5 * 10) * scale },
    ]);
    expect(g.net).toBeCloseTo(g.byStrike.reduce((s, p) => s + p.gex, 0), 15);
    expect(g.flipStrike).toBe(110);
  });

  it("HC-WS-100 flip strike is null when the cumulative exposure never changes sign; zero rows do not flip", () => {
    expect(gammaExposure([{ strike: 1, callGamma: 1, callOi: 1 }, { strike: 2, callGamma: 1, callOi: 1 }], 10, 1).flipStrike).toBeNull();
    expect(gammaExposure([{ strike: 1 }, { strike: 2, putGamma: 1, putOi: 1 }], 10, 1).flipStrike).toBeNull();
    const back = gammaExposure(
      [
        { strike: 1, putGamma: 1, putOi: 1 },
        { strike: 2, callGamma: 1, callOi: 1 },
        { strike: 3, callGamma: 1, callOi: 1 },
      ],
      10,
      1,
    );
    expect(back.flipStrike).toBe(3);
    expect(gammaExposure([], 10, 1)).toEqual({ byStrike: [], net: 0, flipStrike: null });
  });
});

describe("HC-WS-094 volatility smile", () => {
  it("HC-WS-094 uses the out-of-the-money side around the spot, ascending by strike", () => {
    expect(smile(rows, 100)).toEqual([
      { strike: 90, iv: 0.46 },
      { strike: 100, iv: 0.4 },
      { strike: 110, iv: 0.5 },
    ]);
  });

  it("HC-WS-094 averages both sides without a spot and falls back to whichever side exists", () => {
    expect(smile(rows)).toEqual([
      { strike: 90, iv: 0.45 },
      { strike: 100, iv: 0.405 },
      { strike: 110, iv: 0.51 },
    ]);
    const sparse: ChainRow[] = [
      { strike: 80, callIv: 0.6 },
      { strike: 90, putIv: 0.55 },
      { strike: 100 },
      { strike: 110, callIv: NaN, putIv: 0.5 },
    ];
    expect(smile(sparse)).toEqual([
      { strike: 80, iv: 0.6 },
      { strike: 90, iv: 0.55 },
      { strike: 110, iv: 0.5 },
    ]);
    expect(smile(sparse, 95)).toEqual([
      { strike: 80, iv: 0.6 },
      { strike: 90, iv: 0.55 },
      { strike: 110, iv: 0.5 },
    ]);
    expect(smile([{ strike: 100, callIv: 0.3 }], 200)).toEqual([{ strike: 100, iv: 0.3 }]);
  });
});

describe("HC-SH-078 expected move", () => {
  it("HC-SH-078 is spot × IV × sqrt(days / 365), zero for a non-positive horizon", () => {
    expect(expectedMove(79_528.1, 0.42, 21)).toBeCloseTo(79_528.1 * 0.42 * Math.sqrt(21 / 365), 10);
    expect(expectedMove(79_528.1, 0.42, 0)).toBe(0);
    expect(expectedMove(79_528.1, 0.42, -3)).toBe(0);
  });
});

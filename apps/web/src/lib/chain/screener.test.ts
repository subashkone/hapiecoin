// The screener fold (ADR-076; HC-WS-110, 111): rows per quoted option, the per-day figures, IV against ATM, the
// break-even sign, the expiry rows and the filters, on the recorded chain fixture.
import { ACT_365, calendarFor, daysToExpiryOf } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import { buildChain } from "../../../test/fixtures/chain";
import { atmIvOf, skew25 } from "./structure";
import { chainTotals } from "./range";
import { DEFAULT_FILTERS, DELTA_BANDS, MIN_DAYS, filterStrikes, inDeltaBand, screen } from "./screener";

const NEAR = "2026-09-25";
const FAR = "2026-10-30";
const NOW = Date.UTC(2026, 8, 12, 9, 0, 0); // 12 Sep 2026 09:00 UTC
const SPOT = 79_521;
const CAL = calendarFor(12);
const near = buildChain("BTC", NEAR);
const far = buildChain("BTC", FAR);
const chains = new Map([
  [NEAR, near],
  [FAR, far],
]);

describe("HC-WS-110 strike rows", () => {
  it("builds one row per quoted side of every strike on every priced expiry, in listing order", () => {
    const s = screen({ asset: "BTC", chains, spot: SPOT, nowMs: NOW, calendar: CAL });
    const quoted = [...near, ...far].reduce((n, r) => n + (r.call ? 1 : 0) + (r.put ? 1 : 0), 0);
    expect(s.strikes).toHaveLength(quoted);
    expect(s.priced).toEqual([NEAR, FAR]);
    expect(s.expiries.map((e) => e.expiry)).toEqual([NEAR, FAR]);
    expect(new Set(s.strikes.map((r) => r.id)).size).toBe(s.strikes.length);
  });

  it("reads the per-day figures, IV against the expiry's ATM and the break-even sign from the quote", () => {
    const s = screen({ asset: "BTC", chains, spot: SPOT, nowMs: NOW, calendar: CAL });
    const days = daysToExpiryOf(CAL, NOW, NEAR);
    const atm = atmIvOf(near, SPOT)!;
    const row = near.find((r) => Number(r.strike) > SPOT && r.call && r.put)!;
    const call = s.strikes.find((r) => r.expiry === NEAR && r.strike === row.strike && r.side === "call")!;
    const put = s.strikes.find((r) => r.expiry === NEAR && r.strike === row.strike && r.side === "put")!;
    expect(call.days).toBeCloseTo(days, 9);
    expect(call.mark).toBe(Number(row.call!.mark));
    expect(call.premiumPerDay).toBeCloseTo(Number(row.call!.mark) / days, 9);
    expect(call.yieldPerDay).toBeCloseTo((Number(row.call!.mark) / days / SPOT) * 100, 9);
    expect(call.ivVsAtm).toBeCloseTo((row.call!.markIv! - atm) * 100, 9);
    expect(call.delta).toBeCloseTo(Math.abs(row.call!.greeks!.delta), 9);
    expect(call.breakEvenPct).toBeCloseTo(((Number(row.strike) + Number(row.call!.mark)) / SPOT - 1) * 100, 9);
    expect(call.breakEvenPct).toBeGreaterThan(0); // a call above spot breaks even above spot
    expect(put.breakEvenPct).toBeCloseTo(((Number(row.strike) - Number(row.put!.mark)) / SPOT - 1) * 100, 9);
    expect(put.delta).toBeGreaterThanOrEqual(0); // |Δ|
    expect(call.oi).toBe(Number(row.call!.oi));
  });

  it("drops a settled expiry and floors the per-day divisor at one hour; without spot the spot-based figures are null", () => {
    const late = Date.UTC(2026, 8, 25, 11, 59, 0); // one minute before the near settlement
    const s = screen({ asset: "BTC", chains, spot: SPOT, nowMs: late, calendar: CAL });
    expect(s.priced).toEqual([NEAR, FAR]);
    const nearRows = s.strikes.filter((r) => r.expiry === NEAR);
    expect(nearRows.length).toBeGreaterThan(0);
    for (const r of nearRows) expect(r.premiumPerDay).toBeCloseTo(r.mark / MIN_DAYS, 6);
    const settled = screen({ asset: "BTC", chains, spot: SPOT, nowMs: Date.UTC(2026, 8, 25, 12, 0, 0), calendar: CAL });
    expect(settled.priced).toEqual([FAR]);
    expect(settled.strikes.every((r) => r.expiry === FAR)).toBe(true);
    const noSpot = screen({ asset: "BTC", chains, spot: null, nowMs: NOW, calendar: CAL });
    expect(noSpot.strikes.length).toBe(s.strikes.length);
    for (const r of noSpot.strikes) {
      expect(r.yieldPerDay).toBeNull();
      expect(r.breakEvenPct).toBeNull();
      expect(r.ivVsAtm).toBeNull();
    }
    const empty = screen({ asset: "BTC", chains: new Map([[NEAR, []]]), spot: SPOT, nowMs: NOW, calendar: CAL });
    expect(empty.priced).toEqual([]);
    expect(empty.termShape).toBe(screen({ asset: "BTC", chains: new Map(), spot: SPOT, nowMs: NOW, calendar: ACT_365 }).termShape);
  });
});

describe("HC-WS-110 rows without greeks or IV (a venue seed without them)", () => {
  it("keeps the row with null delta, IV and IV−ATM, so it fits only the 'any' band", () => {
    const bare = near.map((r) => ({ strike: r.strike, call: r.call ? { ...r.call, markIv: undefined, greeks: undefined } : undefined, put: r.put ? { ...r.put, markIv: undefined, greeks: undefined } : undefined }));
    const s = screen({ asset: "BTC", chains: new Map([[NEAR, bare]]), spot: SPOT, nowMs: NOW, calendar: CAL });
    expect(s.strikes.length).toBe(near.reduce((n, r) => n + (r.call ? 1 : 0) + (r.put ? 1 : 0), 0));
    for (const r of s.strikes) {
      expect(r.delta).toBeNull();
      expect(r.iv).toBeNull();
      expect(r.ivVsAtm).toBeNull();
      expect(Number.isFinite(r.premiumPerDay)).toBe(true);
    }
    expect(s.expiries[0]!.atmIv).toBeNull();
    expect(s.expiries[0]!.skewPts).toBeNull();
    expect(s.expiries[0]!.expectedMove).toBeNull();
    expect(filterStrikes(s.strikes, { ...DEFAULT_FILTERS, delta: "≤0.10" })).toHaveLength(0);
    expect(filterStrikes(s.strikes, DEFAULT_FILTERS)).toHaveLength(s.strikes.length);
  });
});

describe("HC-WS-111 expiry rows", () => {
  it("carries days, ATM IV, the 25Δ skew, the expected move and the OI totals per expiry", () => {
    const s = screen({ asset: "BTC", chains, spot: SPOT, nowMs: NOW, calendar: CAL });
    const e = s.expiries[0]!;
    const totals = chainTotals(near);
    expect(e.days).toBeCloseTo(daysToExpiryOf(CAL, NOW, NEAR), 9);
    expect(e.atmIv).toBe(atmIvOf(near, SPOT));
    expect(e.skewPts).toBe(skew25(near)!.skewPts);
    expect(e.expectedMove).toBeCloseTo(SPOT * e.atmIv! * Math.sqrt(e.days / 365), 6);
    expect(e.expectedMovePct).toBeCloseTo((e.expectedMove! / SPOT) * 100, 9);
    expect(e).toMatchObject({ callOi: totals.callOi, putOi: totals.putOi, pcr: totals.pcr, strikes: near.length });
    expect(["contango", "backwardation", "flat", null]).toContain(s.termShape);
  });
});

describe("HC-WS-110 filters", () => {
  it("keeps rows by side, |Δ| band, expiry set and minimum OI; a row without a delta fits only 'any'", () => {
    const s = screen({ asset: "BTC", chains, spot: SPOT, nowMs: NOW, calendar: CAL });
    expect(filterStrikes(s.strikes, DEFAULT_FILTERS)).toHaveLength(s.strikes.length);
    expect(filterStrikes(s.strikes, { ...DEFAULT_FILTERS, side: "put" }).every((r) => r.side === "put")).toBe(true);
    const calls = filterStrikes(s.strikes, { ...DEFAULT_FILTERS, side: "call" });
    const puts = filterStrikes(s.strikes, { ...DEFAULT_FILTERS, side: "put" });
    expect(calls.length + puts.length).toBe(s.strikes.length);
    for (const band of DELTA_BANDS) {
      const kept = filterStrikes(s.strikes, { ...DEFAULT_FILTERS, delta: band });
      for (const r of kept) expect(inDeltaBand(r.delta, band)).toBe(true);
    }
    const bands = DELTA_BANDS.filter((b) => b !== "any").map((b) => filterStrikes(s.strikes, { ...DEFAULT_FILTERS, delta: b }).length);
    expect(bands.reduce((a, b) => a + b, 0)).toBe(s.strikes.filter((r) => r.delta !== null).length);
    expect(inDeltaBand(null, "any")).toBe(true);
    expect(inDeltaBand(null, "≤0.10")).toBe(false);
    expect(inDeltaBand(0.1, "≤0.10")).toBe(true);
    expect(inDeltaBand(0.1, "0.10–0.30")).toBe(false);
    expect(inDeltaBand(0.3, "0.10–0.30")).toBe(true);
    expect(inDeltaBand(0.5, "0.30–0.50")).toBe(true);
    expect(inDeltaBand(0.51, ">0.50")).toBe(true);
    expect(filterStrikes(s.strikes, { ...DEFAULT_FILTERS, expiries: new Set([FAR]) }).every((r) => r.expiry === FAR)).toBe(true);
    const oi = filterStrikes(s.strikes, { ...DEFAULT_FILTERS, minOi: 1 });
    expect(oi.every((r) => r.oi >= 1)).toBe(true);
    expect(oi.length).toBeLessThanOrEqual(s.strikes.length);
  });
});

// Payoff preview data (HC-PB-042, 044, 046, 049): presets, legs, zoom, SD bands, synthetic OI and the formatters.
import { describe, expect, it } from "vitest";
import { PRESETS, PREVIEW_DAYS, computePreview, dayLabel, fmtK, fmtSigned, pctFrom, previewExpiry, previewLegs, sdBands, syntheticOi, zoomIn, zoomOut, zoomRange } from "./payoff-preview";

const NOW = Date.UTC(2026, 8, 9, 9, 0, 0);

describe("presets and legs", () => {
  it("ships the four reference presets with one-BTC legs 30 days out", () => {
    expect(PRESETS.map((p) => p.name)).toEqual(["Iron Condor", "Long Call (Unlimited)", "Short Strangle (Both Unlimited)", "Wide chain, narrow leg (BTC 78k, chain 69k-87k)"]);
    const expiry = previewExpiry(NOW);
    expect(expiry).toBe("2026-10-09");
    const legs = previewLegs(PRESETS[0]!, expiry);
    expect(legs).toHaveLength(4);
    expect(legs[0]).toEqual({ kind: "put", side: "buy", strike: 90_000, expiry, quantity: 1, price: 200, iv: 0.55 });
  });

  it("zooms in ×1.25 steps between 50 % and 400 % and narrows the price axis around spot", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.8);
    let z = 1;
    for (let i = 0; i < 20; i++) z = zoomIn(z);
    expect(z).toBe(4);
    for (let i = 0; i < 20; i++) z = zoomOut(z);
    expect(z).toBe(0.5);
    expect(zoomRange(100_000, 1)).toEqual([82_000, 118_000]);
    expect(zoomRange(100_000, 2)).toEqual([91_000, 109_000]);
  });

  it("derives lognormal SD bands from the average IV over the target horizon or to expiry", () => {
    const mid = sdBands(PRESETS[1]!, 15);
    expect(mid.byExpiry).toBe(false);
    expect(mid.days).toBe(15);
    expect(mid.m1).toBeLessThan(100_000);
    expect(mid.p1).toBeGreaterThan(100_000);
    expect(mid.p2).toBeGreaterThan(mid.p1);
    const exp = sdBands(PRESETS[1]!, 0);
    expect(exp.byExpiry).toBe(true);
    expect(exp.days).toBe(PREVIEW_DAYS);
    expect(exp.p1).toBeGreaterThan(mid.p1); // longer horizon, wider band
  });

  it("shapes open interest around spot, normalised to 1, over the preset's strike range", () => {
    const oi = syntheticOi(PRESETS[0]!);
    expect(oi).toHaveLength(31);
    expect(Math.max(...oi.map((o) => o.value))).toBe(1);
    expect(oi.every((o) => o.strike % 1000 === 0)).toBe(true);
    const wide = syntheticOi(PRESETS[3]!);
    expect(wide[0]?.strike).toBe(69_000);
    expect(wide.at(-1)?.strike).toBe(87_000);
  });

  it("prices a preset: the iron condor collects a credit with two breakevens and capped extremes", () => {
    const c = computePreview(PRESETS[0]!, { nowMs: NOW, day: 15, target: 100_000, zoom: 1 });
    expect(c.result.netPremium).toBe(1200);
    expect(c.result.breakevens).toHaveLength(2);
    expect(c.result.maxProfit).toBe(1200);
    expect(c.result.maxLoss).toBe(-3800);
    expect(c.result.points).toHaveLength(241);
    expect(c.range).toEqual([82_000, 118_000]);
    expect(c.result.target.pnlExpiry).toBe(1200);
    const call = computePreview(PRESETS[1]!, { nowMs: NOW, day: 0, target: 110_000, zoom: 2 });
    expect(call.result.maxProfit).toBe(Infinity);
    expect(call.result.target.pnlExpiry).toBe(8500);
  });

  it("formats prices, signed money, percent and the day label", () => {
    expect(fmtK(100_000)).toBe("$100k");
    expect(fmtK(78_500)).toBe("$78.5k");
    expect(fmtSigned(1234)).toBe("+$1.2k");
    expect(fmtSigned(-350)).toBe("-$350");
    expect(fmtSigned(123_456)).toBe("+$123k");
    expect(pctFrom(100_000, 101_500)).toBe("+1.5%");
    expect(pctFrom(100_000, 98_000)).toBe("-2.0%");
    expect(dayLabel(NOW, 0)).toMatch(/^\w{3}, \d{2} \w{3} \d{2}:\d{2} [AP]M$/);
  });
});

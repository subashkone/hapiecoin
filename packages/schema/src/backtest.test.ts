// Sweep values (ADR-100; HC-TR-204): each swept value is checked against the single run's own field (bounds and
// integrality) and the list must strictly increase; the route turns a null into a 400 before any data is read.
import { describe, expect, it } from "vitest";
import { SWEEP_AXES, SweepQuery, parseSweepValues } from "./backtest.js";

describe("HC-TR-204 parseSweepValues", () => {
  it("accepts increasing values inside the field's bounds, for every axis", () => {
    expect(parseSweepValues("minDte", "7,14,30")).toEqual([7, 14, 30]);
    expect(parseSweepValues("smaDays", "20,50,100,200")).toEqual([20, 50, 100, 200]);
    expect(parseSweepValues("targetPct", "25,50,75")).toEqual([25, 50, 75]);
    expect(parseSweepValues("stopPct", "50,100,200,500")).toEqual([50, 100, 200, 500]);
    expect(parseSweepValues("timeStopDte", "0,1,2,7,21")).toEqual([0, 1, 2, 7, 21]);
    for (const axis of SWEEP_AXES) expect(parseSweepValues(axis, "7")).toEqual([7]);
  });

  it("is null when a value leaves the field's bounds or is not an integer where the field wants one", () => {
    expect(parseSweepValues("minDte", "0,7")).toBeNull(); // below 1
    expect(parseSweepValues("minDte", "7,366")).toBeNull(); // above 365
    expect(parseSweepValues("smaDays", "1,20")).toBeNull(); // below 2
    expect(parseSweepValues("smaDays", "20,401")).toBeNull(); // above 400
    expect(parseSweepValues("timeStopDte", "1.5,2")).toBeNull(); // integer field
    expect(parseSweepValues("stopPct", "100,501")).toBeNull(); // above 500
    expect(parseSweepValues("targetPct", "0.5,50")).toBeNull(); // below 1
  });

  it("is null when the list does not strictly increase", () => {
    expect(parseSweepValues("targetPct", "50,50")).toBeNull();
    expect(parseSweepValues("stopPct", "100,50")).toBeNull();
    expect(parseSweepValues("minDte", "7,14,14,30")).toBeNull();
  });

  it("the sweep query takes the single run's fields without folds and needs a first axis with its values", () => {
    const q = SweepQuery.parse({ asset: "BTC", template: "Iron Condor", axis1: "minDte", values1: "7,14,30" });
    expect(q.lots).toBe(10);
    expect(q.fees).toBe("venue");
    expect("folds" in q).toBe(false);
    expect(SweepQuery.safeParse({ asset: "BTC", template: "Iron Condor", axis1: "minDte", values1: "7,,14" }).success).toBe(false);
    expect(SweepQuery.safeParse({ asset: "BTC", template: "Iron Condor", axis1: "lots", values1: "1,2" }).success).toBe(false);
  });
});

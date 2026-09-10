// Alerts schema (ADR-052): create rules per kind, patch shape, the condition test and the counts.
import { describe, expect, it } from "vitest";
import { Alert, AlertCreate, AlertPatch, alertCounts, alertMet } from "./alerts.js";

const base = { kind: "price", asset: "BTC", op: ">=", value: "82000", channels: ["push"] } as const;

describe("HC-SH-094 / HC-SH-098 alert schemas", () => {
  it("accepts a price, an IV and a P&L alert and rejects the mismatches", () => {
    expect(AlertCreate.safeParse(base).success).toBe(true);
    expect(AlertCreate.safeParse({ ...base, kind: "iv", value: "30" }).success).toBe(true);
    expect(AlertCreate.safeParse({ ...base, kind: "pnl", strategyId: "str_1", value: "-20.5", channels: ["push", "email"] }).success).toBe(true);
    // a P&L alert needs a strategy; the others must not name one
    expect(AlertCreate.safeParse({ ...base, kind: "pnl" }).success).toBe(false);
    expect(AlertCreate.safeParse({ ...base, strategyId: "str_1" }).success).toBe(false);
    // value rules
    expect(AlertCreate.safeParse({ ...base, value: "0" }).success).toBe(false);
    expect(AlertCreate.safeParse({ ...base, value: "82,000" }).success).toBe(false);
    expect(AlertCreate.safeParse({ ...base, kind: "iv", value: "600" }).success).toBe(false);
    // channels
    expect(AlertCreate.safeParse({ ...base, channels: [] }).success).toBe(false);
    expect(AlertCreate.safeParse({ ...base, channels: ["telegram"] }).success).toBe(true); // ADR-057
    expect(AlertCreate.safeParse({ ...base, channels: ["sms"] }).success).toBe(false);
  });

  it("patches need at least one field and only re-arm or pause", () => {
    expect(AlertPatch.safeParse({}).success).toBe(false);
    expect(AlertPatch.safeParse({ state: "armed" }).success).toBe(true);
    expect(AlertPatch.safeParse({ state: "triggered" }).success).toBe(false);
    expect(AlertPatch.safeParse({ value: "81000", channels: ["email"] }).success).toBe(true);
  });

  it("a stored alert round-trips", () => {
    const a = { id: "alr_1", ...base, channels: ["push"], strategyId: null, strategyName: null, state: "armed", lastValue: null, triggeredAt: null, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
    expect(Alert.safeParse(a).success).toBe(true);
    expect(Alert.safeParse({ ...a, extra: 1 }).success).toBe(false);
  });
});

describe("HC-SH-096 alertMet and alertCounts", () => {
  it("compares on the operator and ignores unreadable values", () => {
    expect(alertMet({ op: ">=", value: "82000" }, 82000)).toBe(true);
    expect(alertMet({ op: ">=", value: "82000" }, 81999.9)).toBe(false);
    expect(alertMet({ op: "<=", value: "-20" }, -25)).toBe(true);
    expect(alertMet({ op: "<=", value: "-20" }, -19)).toBe(false);
    expect(alertMet({ op: "<=", value: "30" }, Number.NaN)).toBe(false);
  });
  it("counts by state", () => {
    expect(alertCounts([{ state: "armed" }, { state: "armed" }, { state: "triggered" }, { state: "paused" }])).toEqual({ total: 4, armed: 2, triggered: 1, paused: 1 });
    expect(alertCounts([])).toEqual({ total: 0, armed: 0, triggered: 0, paused: 0 });
  });
});

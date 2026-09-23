// GAPS #114: the recorded expiries move to the present as whole days, and every served expiry maps back to its recording.
import { describe, expect, it } from "vitest";
import { RECORDED_TODAY, daysBetween, recordedExpiry, shiftExpiries, shiftIso, yesterdayIso } from "./expiry-shift";

const RECORDED = { BTC: ["2026-09-07", "2026-09-11", "2026-09-25", "2026-11-27"], ETH: ["2026-09-11"], XAUT: [] as string[] };

describe("GAPS #114 the recorded expiries served as of today", () => {
  it("shifts by whole days so the recorded today lands on the target, keeps the order and maps each served date back", () => {
    const s = shiftExpiries(RECORDED, "2026-09-22");
    expect(s.days).toBe(15);
    expect(s.served.BTC).toEqual(["2026-09-22", "2026-09-26", "2026-10-10", "2026-12-12"]);
    expect(s.served.ETH).toEqual(["2026-09-26"]);
    expect(s.served.XAUT).toEqual([]);
    expect(s.toRecorded.get("2026-10-10")).toBe("2026-09-25");
    expect(s.toRecorded.get("2026-12-12")).toBe("2026-11-27");
    expect(s.toRecorded.get("2026-09-25")).toBeUndefined(); // a recorded date is not a served one
  });

  it("serves the recording as it is without a target, and moves backwards when the target is earlier", () => {
    expect(shiftExpiries(RECORDED, undefined).served.BTC).toEqual(RECORDED.BTC);
    expect(shiftExpiries(RECORDED, undefined).days).toBe(0);
    expect(shiftExpiries(RECORDED, "2026-09-05").served.BTC[0]).toBe("2026-09-05");
  });

  it("date arithmetic is in UTC whole days across a month end and a year end", () => {
    expect(daysBetween("2026-09-07", "2026-10-01")).toBe(24);
    expect(shiftIso("2026-12-25", 10)).toBe("2027-01-04");
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween(RECORDED_TODAY, RECORDED_TODAY)).toBe(0);
  });

  it("the servers align the recorded today to yesterday, so a served expiry is never today's", () => {
    const now = Date.UTC(2026, 8, 23, 23, 30); // late in the day UTC
    expect(yesterdayIso(now)).toBe("2026-09-22");
    const s = shiftExpiries(RECORDED, yesterdayIso(now));
    expect(s.served.BTC[0]).toBe("2026-09-22"); // the recorded today became yesterday: already expired, whatever the hour
    expect(s.served.BTC.slice(1).every((e) => e > "2026-09-23")).toBe(true); // the rest lie strictly ahead
    // a browser test that reads the recorded ladder for a served expiry maps it back the same way
    expect(recordedExpiry("2026-10-10", "2026-09-22")).toBe("2026-09-25");
    expect(recordedExpiry(s.served.BTC[3]!, yesterdayIso(now))).toBe("2026-11-27");
  });
});

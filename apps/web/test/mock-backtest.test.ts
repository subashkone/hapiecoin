// HC-TR-185: the mock backtest's history has listed expiries on any real day, not only inside the recording's calendar.
import { describe, expect, it } from "vitest";
import { RECORDED_TODAY } from "./expiry-shift";
import { expiriesOf } from "./fixtures/chain";
import { mockBacktest, mockEodDays } from "./mock-backtest";

const DAY = 86_400_000;

describe("HC-TR-185 the mock backtest on any real day", () => {
  it("HC-TR-185 the day after the recording the history is the recording itself: every expiry on its recorded date", () => {
    const now = Date.parse(`${RECORDED_TODAY}T10:00:00Z`) + DAY;
    const days = mockEodDays("BTC", 3, now);
    expect(days.map((d) => d.day)).toEqual(["2026-09-06", "2026-09-07", "2026-09-08"]);
    expect(days[0]!.expiries.map((e) => e.expiry)).toEqual(expiriesOf().BTC.filter((e) => e >= "2026-09-06"));
    // a day lists only the expiries that have not passed
    expect(days[2]!.expiries.map((e) => e.expiry)).toEqual(expiriesOf().BTC.filter((e) => e >= "2026-09-08"));
  });

  it("HC-TR-185 long after the last recorded expiry every history day still lists expiries with their recorded ladders, and a backtest finds entries", () => {
    const last = expiriesOf().BTC.at(-1)!;
    const now = Date.parse(`${last}T10:00:00Z`) + 200 * DAY;
    const days = mockEodDays("BTC", 12, now);
    expect(days).toHaveLength(12);
    for (const d of days) {
      expect(d.expiries.length).toBeGreaterThan(0);
      for (const e of d.expiries) {
        expect(e.expiry >= d.day).toBe(true);
        expect(e.rows.length).toBeGreaterThan(0);
      }
    }
    // the same spacing as the recording: the furthest expiry is as far from the newest day as it was on the recorded day
    const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
    expect(span(days.at(-1)!.day, days.at(-1)!.expiries.at(-1)!.expiry)).toBe(span(RECORDED_TODAY, last) - 1);
  });

  it("HC-TR-185 the mock backtest of today's real clock is not empty", () => {
    const r = mockBacktest({ asset: "BTC", template: "Bull Call Spread", lots: 10, minDte: 7, from: undefined, to: undefined, days: 12, venue: "delta_india", fees: "venue" });
    expect(r!.trades.length).toBeGreaterThan(0);
  });
});

import { ACT_365, calendarFor } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { CURRENT_VENUE, currentVenue, exerciseLabel, exerciseStyleOf, venueCalendar } from "./venue";

describe("HC-SH-121 the venue seam: calendar and exercise style (ADR-066)", () => {
  it("the pricing calendar is act/365 at the venue's settlement hour: 12:00 for BTC and ETH, 16:00 for XAUT", () => {
    expect(currentVenue().id).toBe(CURRENT_VENUE);
    expect(venueCalendar("BTC")).toBe(ACT_365);
    expect(venueCalendar("ETH")).toEqual({ daysPerYear: 365, settlementHourUtc: 12 });
    expect(venueCalendar("XAUT")).toEqual(calendarFor(16));
    expect(venueCalendar("SOL")).toBe(ACT_365); // an unlisted underlying takes the venue default
    for (const asset of ["BTC", "ETH", "XAUT"]) expect(settlementHourUtc(asset)).toBe(venueCalendar(asset).settlementHourUtc);
  });

  it("Delta India options exercise European; the caption flags American as a model estimate", () => {
    expect(exerciseStyleOf("BTC")).toBe("european");
    expect(exerciseStyleOf("SOL")).toBe("european");
    expect(exerciseLabel("european")).toBe("European exercise");
    expect(exerciseLabel("american")).toBe("American exercise (European-model estimate)");
  });
});

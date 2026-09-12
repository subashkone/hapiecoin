import { ACT_365, calendarFor } from "@hapiecoin/pricing";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { afterEach, describe, expect, it } from "vitest";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { bindVenueSource, currentVenue, currentVenueId, dataOnly, dataOnlyNote, exerciseLabel, exerciseStyleOf, lotSizeFor, venueCalendar } from "./venue";

afterEach(() => {
  useUiStore.setState({ venue: DEFAULT_VENUE });
  bindVenueSource(() => useUiStore.getState().venue);
});

describe("HC-SH-121 the venue seam: calendar and exercise style (ADR-066)", () => {
  it("the pricing calendar is act/365 at the venue's settlement hour: 12:00 for BTC and ETH, 16:00 for XAUT", () => {
    expect(currentVenue().id).toBe(currentVenueId());
    expect(currentVenueId()).toBe(DEFAULT_VENUE);
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

describe("HC-SH-124 the venue follows the workspace store (ADR-069)", () => {
  it("currentVenue reads the store; the calendar and the settlement hour follow, a venue argument overrides", () => {
    useUiStore.setState({ venue: "deribit" });
    expect(currentVenueId()).toBe("deribit");
    expect(currentVenue().label).toBe("Deribit");
    expect(venueCalendar("BTC")).toEqual(calendarFor(8)); // Deribit settles at 08:00 UTC
    expect(settlementHourUtc("BTC")).toBe(8);
    expect(settlementHourUtc("XAUT", "delta_india")).toBe(16); // a strategy passes its own venue
    expect(venueCalendar("BTC", "delta_india")).toBe(ACT_365);
    expect(exerciseStyleOf("BTC")).toBe("european");
    expect(exerciseStyleOf("XAUT", "deribit")).toBe("european"); // not listed there: the default style
  });

  it("lotSizeFor: the trader's settings on the default venue, the venue's listed lot elsewhere", () => {
    const settings = { lotSizes: { BTC: "0.002", ETH: "0.01", XAUT: "0.001" } };
    expect(lotSizeFor("delta_india", "BTC", settings)).toBe("0.002");
    expect(lotSizeFor("delta_india", "BTC", undefined)).toBeUndefined(); // settings still loading, as before
    expect(lotSizeFor("deribit", "BTC", settings)).toBe("0.1");
    expect(lotSizeFor("deribit", "BTC", undefined)).toBe("0.1");
    expect(lotSizeFor("deribit", "XAUT", settings)).toBe("1"); // not listed: the port's fallback
  });

  it("names a data-only venue plainly", () => {
    expect(dataOnly("delta_india")).toBe(false);
    expect(dataOnly("deribit")).toBe(true);
    expect(dataOnlyNote("deribit")).toBe("Deribit is data-only on HapieCoin: chains, analysis and paper trading. API keys and live orders are not available.");
  });

  it("a test may bind its own venue source", () => {
    bindVenueSource(() => "deribit");
    expect(currentVenueId()).toBe("deribit");
  });
});

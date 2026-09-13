import { describe, expect, it } from "vitest";
import { RawTicker } from "./delta/raw.js";
import { toQuote } from "./delta/normalize.js";
import { carryOpenInterest } from "./open-interest.js";
import { LIVE_V2_TICKER_FRAME } from "./test-support/fixtures.js";

const NOW = 1_757_600_000_000;
const known = toQuote(RawTicker.parse(LIVE_V2_TICKER_FRAME), NOW);
const none = toQuote(RawTicker.parse({ ...LIVE_V2_TICKER_FRAME, oi: null, oi_contracts: null, mark_price: "2" }), NOW);

describe("HC-WS-116 [VENUES] open interest carried forward over a frame without one (GAPS #15)", () => {
  it("keeps the last pair when the new frame has none, and never when there is nothing to keep or the frame carries its own", () => {
    expect(known.oiContracts).toBe("18947");
    expect(none.oiContracts).toBeNull();
    expect(carryOpenInterest(known, none)).toMatchObject({ mark: "2", oi: known.oi, oiContracts: "18947" });
    expect(carryOpenInterest(undefined, none)).toBe(none); // first sighting: nothing to keep
    expect(carryOpenInterest(none, none)).toBe(none); // never sent: stays unknown
    expect(carryOpenInterest(none, known)).toBe(known); // the frame carries its own
    const zero = { ...known, oi: "0", oiContracts: "0" };
    expect(carryOpenInterest(known, zero)).toBe(zero); // a real zero is a figure, not a gap
  });
});

// HC-TR-144: exchange positions back to legs, lots and P&L.
import { describe, expect, it } from "vitest";
import { lotsFor, parseVenueSymbol, positionPnl, positionToLeg } from "./positions";

const POS = { productId: 101, symbol: "C-BTC-80000-250926", size: -10, entryPrice: "1200", realizedPnl: "0", margin: "12", contractValue: "0.001", mark: "1250" };

describe("[STRATEGY] HC-TR-144 / HC-SH-119 positions → legs through the port codec", () => {
  it("HC-TR-144 parses Delta option and perpetual symbols and rejects the rest", () => {
    expect(parseVenueSymbol("C-BTC-80000-250926")).toEqual({ kind: "call", asset: "BTC", strike: "80000", expiry: "2026-09-25" });
    expect(parseVenueSymbol("P-XAUT-4410.5-080926")).toEqual({ kind: "put", asset: "XAUT", strike: "4410.5", expiry: "2026-09-08" });
    expect(parseVenueSymbol("ETHUSD")).toEqual({ kind: "future", asset: "ETH", strike: "0", expiry: "" });
    expect(parseVenueSymbol("SOLUSD")).toBeNull();
    expect(parseVenueSymbol("C-BTC-80000")).toBeNull();
    expect(parseVenueSymbol("C-BTC-80000-310226")).toBeNull(); // 31 Feb is not a calendar date (the port's codec, ADR-064)
    expect(parseVenueSymbol("C-SOL-80-250926")).toBeNull();
    // the codec returns the strike in canonical decimal form
    expect(parseVenueSymbol("C-BTC-080000-250926")?.strike).toBe("80000");
    expect(parseVenueSymbol("P-XAUT-4410.50-080926")?.strike).toBe("4410.5");
  });

  it("HC-SH-124 parses with the codec of the venue asked for (ADR-069)", () => {
    expect(parseVenueSymbol("BTC-25SEP26-80000-C", "deribit")).toEqual({ kind: "call", asset: "BTC", strike: "80000", expiry: "2026-09-25" });
    expect(parseVenueSymbol("BTC-PERPETUAL", "deribit")).toEqual({ kind: "future", asset: "BTC", strike: "0", expiry: "" });
    expect(parseVenueSymbol("C-BTC-80000-250926", "deribit")).toBeNull();
    expect(positionToLeg({ ...POS, symbol: "BTC-25SEP26-80000-C", contractValue: "1" }, "0.1", "deribit")?.strike).toBe("80000");
    expect(positionToLeg({ ...POS, symbol: "BTC-25SEP26-80000-C", contractValue: "1" }, "0.1", "delta_india")).toBeNull();
  });

  it("HC-TR-144 sizes lots from contracts and contract value", () => {
    expect(lotsFor(10, "0.001", "0.001")).toBe(10);
    expect(lotsFor(30, "0.001", "0.01")).toBe(3);
    expect(lotsFor(5, "0.001", "0.01")).toBeNull(); // half a lot
    expect(lotsFor(0, "0.001", "0.001")).toBeNull();
    expect(lotsFor(1, "0", "0.001")).toBeNull();
  });

  it("HC-TR-144 turns a short position into a sell leg at its entry price and prices its P&L at the mark", () => {
    expect(positionToLeg(POS, "0.001")).toMatchObject({ id: "pos_101", asset: "BTC", kind: "call", side: "sell", strike: "80000", expiry: "2026-09-25", lots: 10, price: "1200", status: "open" });
    expect(positionToLeg({ ...POS, size: 10 }, "0.001")?.side).toBe("buy");
    expect(positionToLeg({ ...POS, size: 0 }, "0.001")).toBeNull();
    expect(positionToLeg({ ...POS, symbol: null }, "0.001")).toBeNull();
    expect(positionToLeg({ ...POS, contractValue: null }, "0.001")).toBeNull();
    expect(positionToLeg({ ...POS, symbol: "DOGEUSD" }, "0.001")).toBeNull();
    expect(positionToLeg({ ...POS, size: -5 }, "0.01")).toBeNull(); // not a whole lot
    expect(positionPnl(POS)).toBeCloseTo(-0.5, 6); // short 10 contracts, mark up 50 → −0.5 USD
    expect(positionPnl({ ...POS, size: 10 })).toBeCloseTo(0.5, 6);
    expect(positionPnl({ ...POS, mark: null })).toBeNull();
  });
});

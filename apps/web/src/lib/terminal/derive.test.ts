import { RAINBOW_MULTIPLIERS, RAINBOW_NAMES } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { annualised, avgFunding, fgAt, hourlyReadings, largestCoin, oiShare, rainbowBandName, venueCoins, venueTotals } from "./derive";
import { EXCHANGES, SECTOR_SLUGS, isExchange, isSector, navActive, navTestId, sectorName, terminalSection, TERMINAL_NAV } from "./nav";

const oi = [
  { symbol: "BTC", venues: [{ venue: "binance", oiUsd: 60, change24h: 0.01 }, { venue: "bybit", oiUsd: 30, change24h: -0.02 }] },
  { symbol: "ETH", venues: [{ venue: "binance", oiUsd: 10, change24h: null }] },
] as unknown as Parameters<typeof venueTotals>[0] & Parameters<typeof venueCoins>[1];
const funding = [
  { symbol: "BTC", venues: [{ venue: "binance", rate: 0.0001, predicted: 0.0002, apr: 0.1095 }, { venue: "okx", rate: -0.0001, predicted: null, apr: -0.1095 }] },
  { symbol: "SOL", venues: [{ venue: "binance", rate: 0.0003, predicted: null, apr: 0.3285 }] },
] as unknown as Parameters<typeof venueCoins>[2];

describe("HC-MT-102..118 venue derivations", () => {
  it("venueTotals sums open interest per venue, counts coins and shares the total", () => {
    const t = venueTotals(oi);
    expect(t.map((x) => x.venue)).toEqual(["binance", "bybit"]);
    expect(t[0]).toEqual({ venue: "binance", oiUsd: 70, coins: 2, share: 0.7 });
    expect(t[1]!.share).toBeCloseTo(0.3);
    expect(venueTotals([])).toEqual([]);
  });
  it("venueCoins merges one venue's open interest and funding by symbol, largest OI first", () => {
    const rows = venueCoins("binance", oi, funding);
    expect(rows.map((r) => r.symbol)).toEqual(["BTC", "ETH", "SOL"]);
    expect(rows[0]).toEqual({ symbol: "BTC", oiUsd: 60, change24h: 0.01, rate: 0.0001, predicted: 0.0002, apr: 0.1095 });
    expect(rows[2]).toEqual({ symbol: "SOL", oiUsd: null, change24h: null, rate: 0.0003, predicted: null, apr: 0.3285 });
    expect(venueCoins("okx", oi, funding)).toEqual([{ symbol: "BTC", oiUsd: null, change24h: null, rate: -0.0001, predicted: null, apr: -0.1095 }]);
    expect(venueCoins("kraken", oi, funding)).toEqual([]);
  });
});

describe("HC-MT-119..128, 144..150 readings", () => {
  it("fgAt reads the daily points from the end with the label", () => {
    const pts = [10, 30, 50, 60, 80].map((v, i) => ({ t: i * 864e5, v }));
    expect(fgAt(pts, 0)).toEqual({ value: 80, label: "Extreme Greed", t: 4 * 864e5 });
    expect(fgAt(pts, 1)!.label).toBe("Greed");
    expect(fgAt(pts, 4)!.label).toBe("Extreme Fear");
    expect(fgAt(pts, 5)).toBeNull();
  });
  it("hourlyReadings merges the three series by timestamp, newest first, capped", () => {
    const g = [1, 2, 3].map((v) => ({ t: v * 3600e3, v: 1 + v / 10 }));
    const rows = hourlyReadings({ global: g, topAccounts: [{ t: 2 * 3600e3, v: 1.5 }], topPositions: [] }, 2);
    expect(rows).toEqual([
      { t: 3 * 3600e3, global: 1.3, topAccounts: null, topPositions: null },
      { t: 2 * 3600e3, global: 1.2, topAccounts: 1.5, topPositions: null },
    ]);
  });
  it("avgFunding and annualised follow the funding conventions", () => {
    expect(avgFunding([{ rate: 0.0001 }, { rate: -0.0003 }, { rate: null }])).toBeCloseTo(-0.0001);
    expect(avgFunding([{ rate: null }])).toBeNull();
    expect(annualised(0.0001)).toBeCloseTo(0.1095);
    expect(annualised(null)).toBeNull();
  });
  it("rainbowBandName names the band the close sits in", () => {
    expect(rainbowBandName(100, 100, RAINBOW_MULTIPLIERS, RAINBOW_NAMES)).toBe("Accumulate");
    expect(rainbowBandName(1000, 100, RAINBOW_MULTIPLIERS, RAINBOW_NAMES)).toBe("Maximum bubble");
    expect(rainbowBandName(10, 100, RAINBOW_MULTIPLIERS, RAINBOW_NAMES)).toBe("Basically a fire sale");
    expect(rainbowBandName(100, null, RAINBOW_MULTIPLIERS, RAINBOW_NAMES)).toBeNull();
  });
  it("largestCoin and oiShare", () => {
    expect(largestCoin([{ symbol: "BTC", longUsd: 5, shortUsd: 1 }, { symbol: "ETH", longUsd: 4, shortUsd: 4 }])).toEqual({ symbol: "ETH", usd: 8 });
    expect(largestCoin([])).toBeNull();
    expect(oiShare(25, 100)).toBe(0.25);
    expect(oiShare(25, 0)).toBeNull();
    expect(oiShare(null, 100)).toBeNull();
  });
});

describe("HC-MT-011..030 navigation model", () => {
  it("groups, active rules and the section name", () => {
    expect(TERMINAL_NAV.map((g) => g.label)).toEqual(["Markets", "Derivatives", "ETF", "On-chain", "Indicators"]);
    const dash = TERMINAL_NAV[0]!.items[0]!;
    expect(navActive(dash, "/terminal")).toBe(true);
    expect(navActive(dash, "/terminal/spot")).toBe(false);
    const hub = TERMINAL_NAV[0]!.items[1]!;
    expect(hub.ext).toBe(true);
    expect(navActive(hub, "/analytics/hub")).toBe(false);
    const ex = TERMINAL_NAV[0]!.items.find((i) => i.label === "Exchanges")!;
    expect(navActive(ex, "/terminal/exchanges/bybit")).toBe(true);
    expect(terminalSection("/terminal/sectors/defi")).toBe("DeFi");
    expect(terminalSection("/terminal/coin/BTC")).toBe("Coin");
    expect(terminalSection("/terminal/nowhere")).toBe("Terminal");
    expect(navTestId("/terminal")).toBe("tnav-dashboard");
    expect(navTestId("/terminal/derivatives/open-interest")).toBe("tnav-derivatives-open-interest");
    expect(navTestId("/analytics/hub")).toBe("tnav-hub");
  });
  it("sectors and exchanges", () => {
    expect(SECTOR_SLUGS).toEqual(["layer-1", "layer-2", "defi", "memes"]);
    expect(isSector("defi")).toBe(true);
    expect(isSector("xyz")).toBe(false);
    expect(sectorName("layer-2")).toBe("Layer-2");
    expect(sectorName("xyz")).toBe("xyz");
    expect(EXCHANGES).toEqual(["binance", "bybit", "okx"]);
    expect(isExchange("delta")).toBe(false);
  });
});

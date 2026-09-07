/** Test-only loader for the recorded Delta fixtures in spec/fixtures/ (single source of truth). */
import { readFileSync } from "node:fs";
import { deltaRaw, toInstrument, toQuote } from "@hapiecoin/venues";
import type { Instrument, Quote } from "@hapiecoin/venues";

const FIXTURE_DIR = new URL("../../../../spec/fixtures/", import.meta.url);

/** Frozen clock for every fixture-driven test (the fixtures were recorded 04 Sep 2026). */
export const NOW = Date.parse("2026-09-04T12:00:00Z");

export function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8")) as unknown;
}

/** 972 live Delta India option products (BTC 594, ETH 301, XAUT 77). */
export function fixtureInstruments(): Instrument[] {
  return deltaRaw.RawProductsResponse.parse(loadJson("delta-products.json")).result.map(toInstrument);
}

/** 307 BTC call tickers with greeks, IV, OI and spot. */
export function fixtureQuotes(): Quote[] {
  return deltaRaw.RawTickersResponse.parse(loadJson("delta-tickers.json")).result.map((t) => toQuote(t, NOW));
}

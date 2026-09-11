/**
 * Delta Exchange India, the full adapter: the browser-safe core plus the REST, market-data and trading client
 * factories. Server-side only, because the trading client signs requests with node:crypto (ADR-064).
 */
import { DeltaMarketData } from "../delta/market-data.js";
import { DeltaRestClient } from "../delta/rest.js";
import { DeltaTradingClientImpl } from "../delta/trading.js";
import type { VenueAdapter } from "./adapter.js";
import { DELTA_INDIA_CORE } from "./delta-india.js";

export const DELTA_INDIA: VenueAdapter = {
  ...DELTA_INDIA_CORE,
  rest: (options) => new DeltaRestClient(options),
  marketData: (options) => new DeltaMarketData(options),
  trading: (options) => new DeltaTradingClientImpl(options),
};

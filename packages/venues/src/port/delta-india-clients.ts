/**
 * Delta Exchange India, the full adapter: the browser-safe core plus the REST, market-data and trading client
 * factories. Server-side only, because the trading client signs requests with node:crypto (ADR-064).
 */
import { DeltaMarketData } from "../delta/market-data.js";
import { DeltaRestClient } from "../delta/rest.js";
import { DeltaTradingClientImpl } from "../delta/trading.js";
import type { VenueAdapter, VenueRest, VenueRestOptions } from "./adapter.js";
import { DELTA_INDIA_CORE } from "./delta-india.js";

const OPTIONS = ["call_options", "put_options"] as const;

/** The public REST surface the API's snapshotter reads: live options and their tickers. */
export function deltaIndiaRest(options: VenueRestOptions): VenueRest {
  const client = new DeltaRestClient(options);
  return {
    products: () => client.getProducts({ contractTypes: OPTIONS, states: ["live"] }),
    tickers: (underlying, opts) => client.getTickers({ contractTypes: opts?.perpetuals ? [...OPTIONS, "perpetual_futures"] : OPTIONS, underlying }),
  };
}

export const DELTA_INDIA: VenueAdapter = {
  ...DELTA_INDIA_CORE,
  rest: deltaIndiaRest,
  marketData: ({ channel, ...options }) => new DeltaMarketData({ ...options, channel: channel === "v2/ticker" || channel === "ticker" ? channel : undefined }),
  trading: (options) => new DeltaTradingClientImpl(options),
};

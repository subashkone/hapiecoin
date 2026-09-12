/** Deribit, the full adapter: the core plus the public REST and market-data factories. No trading factory: data-only (ADR-067). */
import { DeribitMarketData } from "../deribit/market-data.js";
import { DeribitRestClient } from "../deribit/rest.js";
import type { Quote } from "../types.js";
import type { VenueAdapter, VenueRest, VenueRestOptions } from "./adapter.js";
import { DERIBIT_CORE } from "./deribit.js";

const UNDERLYINGS: readonly string[] = ["BTC", "ETH"];

/** The public REST surface the API's snapshotter reads: live options and their tickers per underlying. */
export function deribitRest(options: VenueRestOptions): VenueRest {
  const client = new DeribitRestClient(options);
  return {
    products: async () => {
      const out = [];
      for (const currency of UNDERLYINGS) out.push(...(await client.getInstruments(currency)));
      return out;
    },
    tickers: async (underlying: string, opts?: { perpetuals?: boolean | undefined }): Promise<Quote[]> => {
      if (!UNDERLYINGS.includes(underlying)) return []; // not a Deribit market (XAUT): no request, no envelope error
      const instruments = await client.getInstruments(underlying);
      const quotes = await client.getBookSummary(underlying, new Map(instruments.map((i) => [i.symbol, i.id])));
      if (opts?.perpetuals) {
        const perpetual = (await client.getInstruments(underlying, "future")).find((i) => i.kind === "perpetual");
        const quote = perpetual ? await client.getTicker(perpetual.symbol, perpetual.id) : null;
        if (quote) quotes.push(quote);
      }
      return quotes;
    },
  };
}

export const DERIBIT: VenueAdapter = {
  ...DERIBIT_CORE,
  rest: deribitRest,
  marketData: (options) => new DeribitMarketData(options),
};

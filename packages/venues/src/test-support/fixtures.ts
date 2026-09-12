/**
 * Test-only loader for the recorded Delta fixtures in spec/fixtures/ (single source of truth;
 * not copied into the package). Excluded from coverage and from the build.
 */
import { readFileSync } from "node:fs";

const FIXTURE_DIR = new URL("../../../../spec/fixtures/", import.meta.url);

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8")) as unknown;
}

/** 972 live Delta India products recorded 04 Sep 2026 (`{ meta, success, result[] }`). */
export function loadProductsFixture(): unknown {
  return loadJson("delta-products.json");
}

/** 307 BTC call tickers with greeks, mark IV, OI and spot (`{ success, result[] }`). */
export function loadTickersFixture(): unknown {
  return loadJson("delta-tickers.json");
}

/** One verbose `v2/ticker` frame captured live from wss://socket.india.delta.exchange on 07 Sep 2026. */
export const LIVE_V2_TICKER_FRAME = {
  mark_high_24h: "2895.04313221",
  sort_priority: 1,
  turnover_usd: 417498.73819999996,
  oi: "18.9470",
  size: 5229,
  timestamp: 1788725363377966,
  oi_reduce_only_mode: false,
  open: 2656.0,
  tick_size: "0.100000000000000000",
  contract_value: "0.001000000000000000",
  close: 2572.0,
  type: "v2/ticker",
  mark_vol: "0.34751966",
  high: 2807.0,
  low: 2453.0,
  greeks: {
    delta: "-0.49848053",
    gamma: "0.00006364",
    rho: "-21.66828721",
    spot: "79777.3",
    theta: "-67.00638062",
    vega: "71.96112211",
  },
  product_trading_status: "operational",
  oi_contracts: "18947",
  top_tag: "",
  mark_change_24h: "-0.9502",
  underlying_asset_symbol: "BTC",
  symbol: "P-BTC-80000-250926",
  oi_value_usd: "1512332.4877",
  ltp_change_24h: "-3.1627",
  tags: [],
  quotes: {
    ask_iv: "0.35119024",
    ask_size: "5794",
    best_ask: "2643",
    best_bid: "2590",
    bid_iv: "0.34382519",
    bid_size: "6044",
    impact_mid_price: null,
    mark_iv: "0.34751911",
  },
  volume: 5.228999999999997,
  contract_type: "put_options",
  product_id: 147880,
  strike_price: "80000",
  leverage: 100,
  oi_change_usd_6h: "52014.5400",
  oi_value_symbol: "BTC",
  price_band: { lower_limit: "1366.56954212", upper_limit: "5115.59854348" },
  turnover: 417498.73819999996,
  turnover_symbol: "USD",
  description: "BTC  Put",
  mark_price: "2616.58595291",
  spot_price: "79777.3",
  time: "2026-09-05T20:04:33.744030383Z",
  oi_value: "18.9470",
  mark_low_24h: "2473.57085694",
};

/** One compact `ticker` frame captured live from wss://public-socket.india.delta.exchange on 07 Sep 2026 (BTCUSD perpetual). */
export const LIVE_COMPACT_TICKER_FRAME = {
  d: [
    {
      g: [null, null, null, null, null],
      i: 27,
      m: "79750.01150815",
      m24hc: "0.0716",
      ohlc: [79694.5, 80093.5, 79212.5, 79753.5],
      oi: ["876853", "768171.7700"],
      pb: ["75761.64455855", "83736.55451209"],
      q: ["79753.5", "552", "79753", "4387", null],
      qiv: [null, null, "-0.38617139"],
      s: "BTCUSD",
      to: [424418623.002998, 424418623.002998],
    },
  ],
  sp: "79777.9",
  sy: "BTCUSD",
  ts: 1788725367575186,
  type: "ticker",
};

/** One Binance combined-stream miniTicker frame captured live on 07 Sep 2026. */
export const LIVE_BINANCE_FRAME = {
  stream: "btcusdt@miniTicker",
  data: {
    e: "24hrMiniTicker",
    E: 1788725597015,
    s: "BTCUSDT",
    c: "79789.86000000",
    o: "79840.00000000",
    h: "80107.99000000",
    l: "79233.00000000",
    v: "8752.00817000",
    q: "698628557.86822230",
  },
};

/** 950 live Deribit BTC options recorded 11 Sep 2026 (`{ jsonrpc, result[] }` of public/get_instruments). */
export function loadDeribitInstrumentsFixture(): unknown {
  return loadJson("deribit-instruments-btc.json");
}

/** public/get_book_summary_by_currency for BTC options, same capture. */
export function loadDeribitBookSummaryFixture(): unknown {
  return loadJson("deribit-book-summary-btc.json");
}

/** 16 near-the-money BTC option tickers (`{ result: RawTicker[] }`) with greeks, same capture. */
export function loadDeribitTickersFixture(): unknown {
  return loadJson("deribit-tickers.json");
}

/** One public/ticker reply, same capture. */
export function loadDeribitTickerFixture(): unknown {
  return loadJson("deribit-ticker.json");
}

/** Live WebSocket frames: subscribe reply, heartbeat test_request, a BTC and an ETH ticker notification, an index notification, the public/test reply. */
export function loadDeribitWsFrames(): Record<string, unknown> {
  return loadJson("deribit-ws-frames.json") as Record<string, unknown>;
}

/** Provider response shapes as documented on 09 Sep 2026 (trimmed). Numbers are strings where the venues send strings. */
import { FakeFetch } from "./fake-fetch.js";

export const T0 = 1_788_900_000_000; // 2026-09-08T04:00:00Z

export const binance = {
  premiumIndex: { symbol: "BTCUSDT", markPrice: "80000.50", indexPrice: "80001.00", lastFundingRate: "0.00010000", nextFundingTime: T0 + 8 * 3_600_000, time: T0 },
  fundingRate: [
    { symbol: "BTCUSDT", fundingTime: T0 - 16 * 3_600_000, fundingRate: "0.00012000", markPrice: "79000" },
    { symbol: "BTCUSDT", fundingTime: T0 - 8 * 3_600_000, fundingRate: "0.00008000", markPrice: "79500" },
  ],
  openInterest: { openInterest: "50000.123", symbol: "BTCUSDT", time: T0 },
  openInterestHist: [
    { symbol: "BTCUSDT", sumOpenInterest: "49000", sumOpenInterestValue: "3900000000", timestamp: T0 - 25 * 3_600_000 },
    { symbol: "BTCUSDT", sumOpenInterest: "49500", sumOpenInterestValue: "3950000000", timestamp: T0 - 2 * 3_600_000 },
    { symbol: "BTCUSDT", sumOpenInterest: "50000", sumOpenInterestValue: "4000000000", timestamp: T0 - 300_000 },
  ],
  ratio: [
    { symbol: "BTCUSDT", longShortRatio: "1.2500", longAccount: "0.5556", shortAccount: "0.4444", timestamp: T0 - 7_200_000 },
    { symbol: "BTCUSDT", longShortRatio: "0.9000", longAccount: "0.4737", shortAccount: "0.5263", timestamp: T0 - 3_600_000 },
  ],
  positionRatio: [{ symbol: "BTCUSDT", longShortRatio: "1.5000", longPosition: "0.6", shortPosition: "0.4", timestamp: T0 - 3_600_000 }],
  taker: [
    { buySellRatio: "1.1", buyVol: "1100", sellVol: "1000", timestamp: T0 - 3_600_000 },
    { buySellRatio: "0.9", buyVol: "900", sellVol: "1000", timestamp: T0 - 7_200_000 },
  ],
};

export const bybit = {
  tickers: { retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", lastPrice: "80010", fundingRate: "0.00005", nextFundingTime: String(T0 + 8 * 3_600_000), openInterest: "20000", openInterestValue: "1600200000" }] } },
  funding: { retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", fundingRate: "0.00006", fundingRateTimestamp: String(T0 - 8 * 3_600_000) }, { symbol: "BTCUSDT", fundingRate: "0.00004", fundingRateTimestamp: String(T0 - 16 * 3_600_000) }] } },
  oi: { retCode: 0, retMsg: "OK", result: { list: [{ openInterest: "19900", timestamp: String(T0 - 600_000) }, { openInterest: "20000", timestamp: String(T0 - 300_000) }] } },
  ratio: { retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", buyRatio: "0.55", sellRatio: "0.45", timestamp: String(T0 - 3_600_000) }, { symbol: "BTCUSDT", buyRatio: "0.5", sellRatio: "0.5", timestamp: String(T0 - 7_200_000) }] } },
  error: { retCode: 10001, retMsg: "params error", result: { list: [] } },
};

export const okx = {
  funding: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.00009", nextFundingRate: "0.00011", nextFundingTime: String(T0 + 8 * 3_600_000), fundingTime: String(T0) }] },
  fundingNoPredicted: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.00009", nextFundingRate: "", nextFundingTime: String(T0 + 8 * 3_600_000) }] },
  fundingHistory: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001", realizedRate: "0.0001", fundingTime: String(T0 - 8 * 3_600_000) }, { instId: "BTC-USDT-SWAP", fundingRate: "0.00012", realizedRate: "0.00012", fundingTime: String(T0 - 16 * 3_600_000) }] },
  oi: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", oi: "1000000", oiCcy: "10000", oiUsd: "800000000", ts: String(T0) }] },
  oiVolume: { code: "0", msg: "", data: [[String(T0 - 300_000), "790000000", "5000000000"], [String(T0 - 600_000), "780000000", "4900000000"]] },
  lsRatio: { code: "0", msg: "", data: [[String(T0 - 3_600_000), "1.3"], [String(T0 - 7_200_000), "1.1"]] },
  ticker: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", last: "80005" }] },
  liquidations: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", details: [{ side: "sell", posSide: "long", bkPx: "79000", sz: "2", ts: String(T0 - 60_000), bkLoss: "0" }, { side: "buy", bkPx: "81000", sz: "1", ts: String(T0 - 120_000), bkLoss: "0" }, { side: "sell", bkPx: "78000", sz: "0.5", ts: String(T0 - 180_000), bkLoss: "0" }] }] },
  error: { code: "51001", msg: "Instrument ID does not exist", data: [] },
  empty: { code: "0", msg: "", data: [] },
};

export const coingecko = {
  markets: [
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 80000, market_cap: 1.6e12, market_cap_rank: 1, total_volume: 3e10, price_change_percentage_1h_in_currency: 0.1, price_change_percentage_24h_in_currency: -1.2, price_change_percentage_7d_in_currency: 3.4, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => 79000 + i) } },
    { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3000, market_cap: 3.6e11, market_cap_rank: 2, total_volume: 1.5e10, sparkline_in_7d: null },
    { id: "weird", symbol: "$weird!", name: "Weird", current_price: 1, market_cap: 1, market_cap_rank: 3, total_volume: 1 },
    { id: "nullprice", symbol: "np", name: "No Price", current_price: null, market_cap: null, market_cap_rank: null, total_volume: null },
  ],
  global: { data: { total_market_cap: { usd: 2.9e12 }, total_volume: { usd: 9e10 }, market_cap_percentage: { btc: 55.1, eth: 12.4 } } },
};

export const deribit = {
  options: {
    jsonrpc: "2.0",
    result: [
      { instrument_name: "BTC-25SEP26-70000-P", open_interest: 100, volume_usd: 1000, underlying_price: 80000, mark_price: 0.01 },
      { instrument_name: "BTC-25SEP26-80000-C", open_interest: 200, volume_usd: 2000, underlying_price: 80000, mark_price: 0.03 },
      { instrument_name: "BTC-25SEP26-80000-P", open_interest: 50, volume_usd: 500, underlying_price: 80000, mark_price: 0.03 },
      { instrument_name: "BTC-25SEP26-90000-C", open_interest: 300, volume_usd: 3000, underlying_price: 80000, mark_price: 0.005 },
      { instrument_name: "BTC-30OCT26-100000-C", open_interest: 10, volume_usd: 0, underlying_price: 80000, mark_price: 0.001 },
      { instrument_name: "BTC-30OCT26-110000-P", open_interest: null, volume_usd: null, underlying_price: null, mark_price: null }, // sparse row
      { instrument_name: "BTC-1SEP26-80000-C", open_interest: 999, volume_usd: 0, underlying_price: 80000, mark_price: 0 }, // expired
      { instrument_name: "BTC-PERPETUAL", open_interest: 1e9, volume_usd: 0, underlying_price: null, mark_price: 80000 }, // not an option name
    ],
  },
  empty: { jsonrpc: "2.0", result: [] },
};
export const delta = {
  options: {
    success: true,
    result: [
      { symbol: "C-BTC-80000-250926", contract_type: "call_options", strike_price: "80000", oi_value: "1.5", oi_value_usd: "120000", turnover_usd: 300, spot_price: "80100" },
      { symbol: "P-BTC-75000-250926", contract_type: "put_options", strike_price: "75000", oi_value: "0.5", oi_value_usd: "40000", turnover_usd: 100, spot_price: "80100" },
      { symbol: "C-BTC-90000-250926", contract_type: "call_options" }, // sparse row: no oi, turnover or spot yet
      { symbol: "BTCUSD", contract_type: "perpetual_futures", oi_value: "10", turnover_usd: 5, spot_price: "80100" },
    ],
  },
  error: { success: false, result: [] },
};
/** Bybit klines newest first: 400 daily closes climbing 0.3 % a day (enough for RSI(14), the 111 and 350-day averages, not the 2-year one). */
export const KLINE_DAYS = 400;
export const bybitKlines = { retCode: 0, retMsg: "OK", result: { list: Array.from({ length: KLINE_DAYS }, (_, i) => [String(T0 - i * 86_400_000), "1", "1", "1", String((100 * 1.003 ** (KLINE_DAYS - 1 - i)).toFixed(2)), "1", "1"]) } };
export const LAST_CLOSE = Number((100 * 1.003 ** (KLINE_DAYS - 1)).toFixed(2));
export const coingeckoTickers = {
  gdax: { name: "Coinbase", tickers: [{ base: "BTC", target: "USD", last: 80050, is_stale: false }, { base: "ETH", target: "USD", last: 3000 }] },
  binance: { name: "Binance", tickers: [{ base: "BTC", target: "USDT", last: 80000 }, { base: "BTC", target: "BUSD", last: null }] },
};

export const fng = { name: "Fear and Greed Index", data: [{ value: "42", value_classification: "Fear", timestamp: String(Math.floor(T0 / 1000)), time_until_update: "1000" }, { value: "60", value_classification: "Greed", timestamp: String(Math.floor(T0 / 1000) - 86_400) }] };

/** A FakeFetch answering every endpoint the jobs call with the fixtures above. */
export function healthyFetch(): FakeFetch {
  return new FakeFetch()
    .on("/fapi/v1/premiumIndex", { body: binance.premiumIndex })
    .on("/fapi/v1/fundingRate", { body: binance.fundingRate })
    .on("/fapi/v1/openInterest", { body: binance.openInterest })
    .on("/futures/data/openInterestHist", { body: binance.openInterestHist })
    .on("/futures/data/globalLongShortAccountRatio", { body: binance.ratio })
    .on("/futures/data/topLongShortAccountRatio", { body: binance.ratio })
    .on("/futures/data/topLongShortPositionRatio", { body: binance.positionRatio })
    .on("/futures/data/takerlongshortRatio", { body: binance.taker })
    .on("/v5/market/tickers", { body: bybit.tickers })
    .on("/v5/market/funding/history", { body: bybit.funding })
    .on("/v5/market/open-interest", { body: bybit.oi })
    .on("/v5/market/account-ratio", { body: bybit.ratio })
    .on("/v5/market/kline", { body: bybitKlines })
    .on("/api/v2/public/get_book_summary_by_currency", { body: deribit.options })
    .on("/v2/tickers", { body: delta.options })
    .on("/api/v3/exchanges/gdax/tickers", { body: coingeckoTickers.gdax })
    .on("/api/v3/exchanges/binance/tickers", { body: coingeckoTickers.binance })
    .on("/api/v5/public/funding-rate", { body: okx.funding })
    .on("/api/v5/public/funding-rate-history", { body: okx.fundingHistory })
    .on("/api/v5/public/open-interest", { body: okx.oi })
    .on("/api/v5/rubik/stat/contracts/open-interest-volume", { body: okx.oiVolume })
    .on("/api/v5/rubik/stat/contracts/long-short-account-ratio", { body: okx.lsRatio })
    .on("/api/v5/market/ticker", { body: okx.ticker })
    .on("/api/v5/public/liquidation-orders", { body: okx.liquidations })
    .on("/api/v3/coins/markets", { body: coingecko.markets })
    .on("/api/v3/global", { body: coingecko.global })
    .on("/fng/", { body: fng });
}

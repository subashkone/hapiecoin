/**
 * @hapiecoin/venues - venue adapters for HapieCoin market data.
 *
 * Delta Exchange India: REST (products, tickers, candles), WebSocket tickers, chain builder.
 * Binance: spot miniTicker stream (BTC/ETH; XAUT falls back to Delta spot_price).
 */
export type {
  Venue,
  InstrumentKind,
  Instrument,
  Greeks,
  Quote,
  Expiry,
  ChainSide,
  ChainRow,
  ChainSnapshot,
  Candle,
  SpotTick,
} from "./types.js";

export { canonDecimal, numberToDecimal, decimalToNumber, compareDecimal, DecimalFormatError } from "./decimal.js";

export {
  DeltaHttpError,
  DeltaSchemaError,
  DeltaApiError,
  InvalidSymbolError,
  InvalidExpiryError,
  UnknownExpiryError,
  StaleConnectionError,
  VenueWsError,
} from "./errors.js";

export { Emitter } from "./emitter.js";
export type { Listener } from "./emitter.js";

export * as deltaRaw from "./delta/raw.js";
export type {
  RawProduct,
  RawProductsResponse,
  RawTicker,
  RawTickersResponse,
  RawTickerResponse,
  RawCandle,
  RawCandlesResponse,
  RawWsV2Ticker,
  RawWsCompactTicker,
  RawWsCompactTickerEntry,
  RawWsSubscriptions,
} from "./delta/raw.js";

export {
  DEFAULT_SETTLEMENT_HOUR_UTC,
  parseOptionSymbol,
  isOptionSymbol,
  expiryCodeToDate,
  dateToExpiryCode,
  expiryCodeToLabel,
  labelToExpiryCode,
  resolveExpiryCode,
  expirySettlementIso,
  contractTypeToKind,
  toInstrument,
  toGreeks,
  toQuote,
  compactToQuote,
} from "./delta/normalize.js";
export type { ParsedOptionSymbol } from "./delta/normalize.js";

export { buildChain, listExpiries, strikeStep } from "./delta/chain.js";
export type { BuildChainInput, StrikeStepReport } from "./delta/chain.js";

export { DeltaRestClient } from "./delta/rest.js";
export type {
  DeltaRestClientOptions,
  DeltaContractType,
  GetProductsParams,
  GetTickersParams,
  GetCandlesParams,
  CandleResolution,
  FetchLike,
} from "./delta/rest.js";

export { DeltaWsClient, DELTA_HEARTBEAT_TIMEOUT_MS } from "./delta/ws.js";
export type { DeltaWsClientOptions, DeltaWsEvents, DeltaTickerChannel, HeartbeatInfo } from "./delta/ws.js";

export { ReconnectingSocket, backoffDelay, DEFAULT_BACKOFF, WS_OPEN } from "./ws/reconnecting.js";
export type {
  WebSocketLike,
  WebSocketCtor,
  BackoffOptions,
  SocketState,
  CloseInfo,
  ReconnectInfo,
  BaseSocketEvents,
  ReconnectingSocketOptions,
} from "./ws/reconnecting.js";

export {
  BinanceSpotClient,
  BINANCE_STREAM_URL,
  BINANCE_STALE_MS,
  binanceStreamName,
  buildBinanceStreamUrl,
  parseMiniTicker,
  RawMiniTickerFrame,
} from "./binance/spot.js";
export type { BinanceSpotClientOptions, BinanceSpotEvents } from "./binance/spot.js";

export { DeltaMarketData, createDeltaMarketData } from "./delta/market-data.js";
export type { DeltaMarketDataOptions, DeltaMarketDataEvents, MarketDataStatus } from "./delta/market-data.js";
export type { MarketDataEvents, VenueMarketData, VenueMarketDataOptions } from "./market-data.js";
export { JsonHttp, snippet } from "./http.js";
export { VenueApiError, VenueHttpError, VenueSchemaError } from "./errors.js";

// ADR-067: Deribit, data-only
export * as deribitRaw from "./deribit/raw.js";
export { DERIBIT_SETTLEMENT_HOUR_UTC, bookSummaryToQuote, coinToUsd, formatDeribitOption, isDeribitOption, parseDeribitOption, parseDeribitPerpetual, toDeribitInstrument, toDeribitQuote } from "./deribit/normalize.js";
export type { ParsedDeribitOption } from "./deribit/normalize.js";
export { DeribitRestClient } from "./deribit/rest.js";
export type { DeribitRestClientOptions } from "./deribit/rest.js";
export { DERIBIT_HEARTBEAT_INTERVAL_S, DERIBIT_HEARTBEAT_TIMEOUT_MS, DeribitWsClient } from "./deribit/ws.js";
export type { DeribitTickerInterval, DeribitWsClientOptions, DeribitWsEvents } from "./deribit/ws.js";
export { DeribitMarketData, createDeribitMarketData } from "./deribit/market-data.js";
export type { DeribitMarketDataOptions } from "./deribit/market-data.js";

export {
  SCHEMA_VENUE,
  schemaVenueOf,
  SchemaAdapterError,
  isSchemaInstrument,
  latestSpot,
  schemaInstrumentId,
  toSchemaChainRows,
  toSchemaChainSnapshot,
  toSchemaInstrument,
  toSchemaQuote,
} from "./schema-adapter.js";

export { DeltaTradingClientImpl, FakeDeltaTradingClient, contractsFor, describeOrderError, fillInstant, roundToTick, signDeltaRequest } from "./delta/trading.js";
export type {
  DeltaCredentials,
  DeltaTradingClient,
  DeltaTradingClientOptions,
  OrderSide,
  OrderState,
  PlaceOrderInput,
  PlaceOrderResult,
  TradingFetch,
  VenueBalance,
  VenueFill,
  FillsPage,
  ListFillsOptions,
  VenueOrder,
  VenuePosition,
  VenueProduct,
} from "./delta/trading.js";


// ADR-063: the venue port; apps look venues up here instead of importing Delta clients directly
export { DEFAULT_VENUE, VENUE_REGISTRY, getVenue, listVenues } from "./port/registry.js";
export { DELTA_INDIA, deltaIndiaRest } from "./port/delta-india-clients.js";
export { DERIBIT, deribitRest } from "./port/deribit-clients.js";
export { DERIBIT_CORE, DERIBIT_MARKETS, deribitLabelToExpiryCode, deribitMarket } from "./port/deribit.js";
export { DELTA_INDIA_CORE, DELTA_INDIA_MARKETS, formatDeltaOption, parseDeltaPerpetual } from "./port/delta-india.js";
export { VENUE_CORES, getVenueCore, listVenueCores } from "./port/core.js";
export { UnknownVenueError, VenueCapabilityError, defaultLotSizes, marketOf, ownMarket, tradingClientOf } from "./port/adapter.js";
export type {
  ExerciseStyle,
  FeeDefaults,
  MarketSpec,
  OptionKind,
  SchemaBridge,
  SymbolCodec,
  VenueAdapter,
  VenueCalendar,
  VenueCapabilities,
  VenueCore,
  VenueId,
  VenueRest,
  VenueRestOptions,
} from "./port/adapter.js";

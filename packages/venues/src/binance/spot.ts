/**
 * Binance spot price stream (`<sym>usdt@miniTicker`) for the spot tiles and the futures ticker.
 *
 * Combined stream URL: wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker
 * Frame: { stream: "btcusdt@miniTicker", data: { e: "24hrMiniTicker", E: ms, s: "BTCUSDT", c, o, h, l, v, q } }
 *
 * XAUT (Tether Gold) has no Binance spot market. PAXG is a different token and is NOT used as a
 * proxy: `binanceStreamName("XAUT")` returns null, XAUT is skipped, and the caller falls back to
 * Delta's `spot_price` (present on every Delta ticker). If every requested underlying is skipped
 * the client never opens a socket.
 */
import { z } from "zod";
import { canonDecimal } from "../decimal.js";
import { DeltaSchemaError } from "../errors.js";
import type { SpotTick } from "../types.js";
import type { BaseSocketEvents, ReconnectingSocketOptions } from "../ws/reconnecting.js";
import { ReconnectingSocket } from "../ws/reconnecting.js";

export const BINANCE_STREAM_URL = "wss://stream.binance.com:9443/stream";

/** Underlyings without a USDT spot market on Binance. */
const UNSUPPORTED = new Set(["XAUT"]);

export function binanceStreamName(underlying: string): string | null {
  const upper = underlying.toUpperCase();
  if (UNSUPPORTED.has(upper) || upper.length === 0) return null;
  return `${upper.toLowerCase()}usdt@miniTicker`;
}

/** Combined-stream URL for the supported underlyings, or null when none is supported. */
export function buildBinanceStreamUrl(underlyings: readonly string[], baseUrl: string = BINANCE_STREAM_URL): string | null {
  const streams = [...new Set(underlyings.map(binanceStreamName).filter((s): s is string => s !== null))];
  if (streams.length === 0) return null;
  return `${baseUrl}?streams=${streams.join("/")}`;
}

export const RawMiniTickerFrame = z.object({
  stream: z.string(),
  data: z.object({
    e: z.literal("24hrMiniTicker"),
    E: z.number(),
    s: z.string(),
    c: z.string(),
    o: z.string(),
    h: z.string().optional(),
    l: z.string().optional(),
    v: z.string().optional(),
    q: z.string().optional(),
  }),
});
export type RawMiniTickerFrame = z.infer<typeof RawMiniTickerFrame>;

/** Parse one combined-stream frame into a SpotTick; returns null for non-miniTicker frames (e.g. subscription acks). */
export function parseMiniTicker(json: unknown): SpotTick | null {
  const parsed = RawMiniTickerFrame.safeParse(json);
  if (!parsed.success) return null;
  const { data } = parsed.data;
  const underlying = data.s.toUpperCase().replace(/USDT$/, "");
  const close = Number(data.c);
  const open = Number(data.o);
  const change24hPct = open > 0 && Number.isFinite(close) ? Number((((close - open) / open) * 100).toFixed(4)) : 0;
  return {
    source: "binance",
    underlying,
    symbol: data.s,
    price: canonDecimal(data.c),
    change24hPct,
    ts: data.E,
  };
}

export interface BinanceSpotClientOptions extends Omit<ReconnectingSocketOptions, "url"> {
  /** Underlyings to stream ("BTC", "ETH", "XAUT"); unsupported ones are skipped. */
  underlyings: readonly string[];
  /** Combined-stream base URL (default BINANCE_STREAM_URL). */
  baseUrl?: string;
}

export interface BinanceSpotEvents extends BaseSocketEvents {
  spot: SpotTick;
}

export const BINANCE_STALE_MS = 30_000;

export class BinanceSpotClient extends ReconnectingSocket<BinanceSpotEvents> {
  /** Underlyings actually streamed (unsupported ones removed). */
  readonly streamed: readonly string[];
  /** Underlyings skipped because Binance has no spot market for them. */
  readonly skipped: readonly string[];

  constructor(options: BinanceSpotClientOptions) {
    const url = buildBinanceStreamUrl(options.underlyings, options.baseUrl) ?? "";
    super({ ...options, url, heartbeatMs: options.heartbeatMs ?? BINANCE_STALE_MS });
    const upper = options.underlyings.map((u) => u.toUpperCase());
    this.streamed = [...new Set(upper.filter((u) => binanceStreamName(u) !== null))];
    this.skipped = [...new Set(upper.filter((u) => binanceStreamName(u) === null))];
  }

  /** Opens the combined stream; does nothing (emits nothing) when no underlying is supported. */
  override connect(): void {
    if (this.url === "") return;
    super.connect();
  }

  protected onSocketOpen(): void {
    // Combined streams are subscribed through the URL; nothing to send. Binance pings every 20 s and
    // the WebSocket implementation answers with pong frames automatically.
  }

  protected onSocketMessage(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.emit("error", new DeltaSchemaError("binance", [`frame is not JSON: ${data.slice(0, 120)}`]));
      return;
    }
    const tick = parseMiniTicker(json);
    if (tick) this.emit("spot", tick);
  }
}

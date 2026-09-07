/**
 * Delta Exchange India ticker WebSocket client.
 *
 * Protocol (docs.delta.exchange "Websocket Feed", confirmed live on 07 Sep 2026):
 *   subscribe   -> { type: "subscribe",   payload: { channels: [{ name, symbols }] } }
 *   unsubscribe -> { type: "unsubscribe", payload: { channels: [{ name, symbols }] } }
 *   ack         <- { type: "subscriptions", channels: [...] }
 *   heartbeat   -> { type: "enable_heartbeat" } ; <- { type: "heartbeat", ts_origin, ts_publish } every 30 s;
 *                  reconnect when nothing arrives for 35 s (default `heartbeatMs`).
 *
 * Channels:
 *   "v2/ticker" on wss://socket.india.delta.exchange        - verbose frames, same shape as REST tickers
 *                (what the original site uses; Delta lists it as legacy but it still serves).
 *   "ticker"    on wss://public-socket.india.delta.exchange - compact frames (`d[]`), parsed too.
 * Both normalise to the same Quote.
 */
import { DeltaSchemaError, VenueWsError } from "../errors.js";
import type { Quote } from "../types.js";
import type { BaseSocketEvents, ReconnectingSocketOptions } from "../ws/reconnecting.js";
import { ReconnectingSocket } from "../ws/reconnecting.js";
import { compactToQuote, toQuote } from "./normalize.js";
import {
  RawWsCompactTicker,
  RawWsEnvelope,
  RawWsError,
  RawWsHeartbeat,
  RawWsSubscriptions,
  RawWsV2Ticker,
  formatIssues,
} from "./raw.js";
import type { RawWsSubscriptions as RawWsSubscriptionsT } from "./raw.js";

export type DeltaTickerChannel = "v2/ticker" | "ticker";

export const DELTA_HEARTBEAT_TIMEOUT_MS = 35_000;

export interface DeltaWsClientOptions extends ReconnectingSocketOptions {
  /** Ticker channel name (default "v2/ticker"). */
  channel?: DeltaTickerChannel;
  /** Clock for `Quote.receivedAt` (default Date.now). */
  now?: () => number;
}

export interface HeartbeatInfo {
  tsOrigin: number | null;
  tsPublish: number | null;
  receivedAt: number;
}

export interface DeltaWsEvents extends BaseSocketEvents {
  ticker: Quote;
  heartbeat: HeartbeatInfo;
  subscriptions: RawWsSubscriptionsT["channels"];
}

export class DeltaWsClient extends ReconnectingSocket<DeltaWsEvents> {
  readonly channel: DeltaTickerChannel;
  private readonly now: () => number;
  private readonly wanted = new Set<string>();

  constructor(options: DeltaWsClientOptions) {
    super({ ...options, heartbeatMs: options.heartbeatMs ?? DELTA_HEARTBEAT_TIMEOUT_MS });
    this.channel = options.channel ?? "v2/ticker";
    this.now = options.now ?? Date.now;
  }

  /** Current symbol set (sorted copy). */
  get symbols(): string[] {
    return [...this.wanted].sort();
  }

  /**
   * Add symbols; only symbols not already subscribed are sent (dedupe). Returns the symbols that
   * were newly added. When the socket is not open they are sent on the next open.
   */
  subscribe(symbols: readonly string[]): string[] {
    const added: string[] = [];
    for (const symbol of symbols) {
      if (this.wanted.has(symbol)) continue;
      this.wanted.add(symbol);
      added.push(symbol);
    }
    if (added.length > 0) this.sendChannel("subscribe", added);
    return added;
  }

  /** Remove symbols; returns the ones that were actually subscribed. */
  unsubscribe(symbols: readonly string[]): string[] {
    const removed: string[] = [];
    for (const symbol of symbols) {
      if (this.wanted.delete(symbol)) removed.push(symbol);
    }
    if (removed.length > 0) this.sendChannel("unsubscribe", removed);
    return removed;
  }

  protected onSocketOpen(): void {
    this.send({ type: "enable_heartbeat" });
    if (this.wanted.size > 0) this.sendChannel("subscribe", [...this.wanted]);
  }

  protected onSocketMessage(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.emit("error", new DeltaSchemaError(this.channel, [`frame is not JSON: ${data.slice(0, 120)}`]));
      return;
    }
    const envelope = RawWsEnvelope.safeParse(json);
    if (!envelope.success) return; // frames without a `type` are not part of the protocol we consume
    switch (envelope.data.type) {
      case "heartbeat":
        this.handleHeartbeat(json);
        return;
      case "v2/ticker":
        this.handleVerboseTicker(json);
        return;
      case "ticker":
        this.handleCompactTicker(json);
        return;
      case "subscriptions":
        this.handleSubscriptions(json);
        return;
      case "error":
        this.handleErrorFrame(json);
        return;
      default:
        return; // other channels / future frame types are ignored
    }
  }

  private sendChannel(type: "subscribe" | "unsubscribe", symbols: readonly string[]): void {
    this.send({ type, payload: { channels: [{ name: this.channel, symbols: [...symbols] }] } });
  }

  private handleHeartbeat(json: unknown): void {
    const parsed = RawWsHeartbeat.safeParse(json);
    /* v8 ignore next -- a heartbeat with a non-numeric ts would be a venue bug; we still stay alive */
    if (!parsed.success) return;
    this.emit("heartbeat", {
      tsOrigin: parsed.data.ts_origin ?? null,
      tsPublish: parsed.data.ts_publish ?? null,
      receivedAt: this.now(),
    });
  }

  private handleVerboseTicker(json: unknown): void {
    const parsed = RawWsV2Ticker.safeParse(json);
    if (!parsed.success) {
      this.emit("error", new DeltaSchemaError("v2/ticker", formatIssues(parsed.error)));
      return;
    }
    this.emit("ticker", toQuote(parsed.data, this.now()));
  }

  private handleCompactTicker(json: unknown): void {
    const parsed = RawWsCompactTicker.safeParse(json);
    if (!parsed.success) {
      this.emit("error", new DeltaSchemaError("ticker", formatIssues(parsed.error)));
      return;
    }
    const receivedAt = this.now();
    for (const entry of parsed.data.d) {
      this.emit("ticker", compactToQuote(entry, { sp: parsed.data.sp ?? null, ts: parsed.data.ts }, receivedAt));
    }
  }

  private handleSubscriptions(json: unknown): void {
    const parsed = RawWsSubscriptions.safeParse(json);
    if (!parsed.success) {
      this.emit("error", new DeltaSchemaError("subscriptions", formatIssues(parsed.error)));
      return;
    }
    this.emit("subscriptions", parsed.data.channels);
    for (const channel of parsed.data.channels) {
      if (channel.error) this.emit("error", new VenueWsError(`subscription refused: ${channel.error}`, channel));
    }
  }

  private handleErrorFrame(json: unknown): void {
    const parsed = RawWsError.safeParse(json);
    const message = parsed.success ? (parsed.data.message ?? "venue error") : "venue error";
    this.emit("error", new VenueWsError(message, json));
  }
}

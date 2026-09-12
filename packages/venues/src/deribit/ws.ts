/**
 * Deribit public WebSocket (JSON-RPC 2.0 over wss://www.deribit.com/ws/api/v2, verified live on 11 Sep 2026):
 * - requests `{ jsonrpc: "2.0", id, method, params }`, replies `{ jsonrpc, id, result | error }`;
 * - `public/subscribe { channels: ["ticker.<name>.100ms", ...] }` answers with the accepted channel list and then
 *   pushes `{ method: "subscription", params: { channel, data } }` where `data` is the `public/ticker` shape;
 * - `public/set_heartbeat { interval }` (≥ 10 s) makes the server send `{ method: "heartbeat", params: { type } }`;
 *   a `test_request` must be answered with `public/test` or the server drops the connection.
 * The liveness watchdog of ReconnectingSocket covers a silent server.
 */
import { VenueSchemaError, VenueWsError } from "../errors.js";
import type { BaseSocketEvents, ReconnectingSocketOptions } from "../ws/reconnecting.js";
import { ReconnectingSocket } from "../ws/reconnecting.js";
import { RawHeartbeatParams, RawIndexNotification, RawRpcNotification, RawRpcReply, RawSubscriptionParams, RawTicker } from "./raw.js";

export type DeribitTickerInterval = "100ms" | "agg2";

/** Heartbeats arrive every `heartbeatIntervalS`; silence for this long means the connection is dead. */
export const DERIBIT_HEARTBEAT_TIMEOUT_MS = 35_000;
export const DERIBIT_HEARTBEAT_INTERVAL_S = 10;

export interface DeribitWsClientOptions extends ReconnectingSocketOptions {
  /** Ticker aggregation interval (default "100ms"). */
  interval?: DeribitTickerInterval | undefined;
}

export interface DeribitWsEvents extends BaseSocketEvents {
  /** A ticker notification (the venue's shape; the session converts it with the instrument list). */
  ticker: RawTicker;
  /** An index price notification. */
  index: { name: string; price: number; ts: number };
  /** The channel list the server accepted for a subscribe / unsubscribe. */
  subscriptions: string[];
  /** A server heartbeat or test request (already answered). */
  heartbeat: { type: "heartbeat" | "test_request" };
}

export class DeribitWsClient extends ReconnectingSocket<DeribitWsEvents> {
  readonly interval: DeribitTickerInterval;
  private readonly wanted = new Set<string>();
  private readonly indexes = new Set<string>();
  private nextId = 1;

  constructor(options: DeribitWsClientOptions) {
    super({ ...options, heartbeatMs: options.heartbeatMs ?? DERIBIT_HEARTBEAT_TIMEOUT_MS });
    this.interval = options.interval ?? "100ms";
  }

  /** Current instrument set (sorted copy). */
  get symbols(): string[] {
    return [...this.wanted].sort();
  }

  /** Add instruments; only new ones are sent. Returns the ones added; sent on the next open when closed. */
  subscribe(symbols: readonly string[]): string[] {
    const added: string[] = [];
    for (const symbol of symbols) {
      if (this.wanted.has(symbol)) continue;
      this.wanted.add(symbol);
      added.push(symbol);
    }
    if (added.length > 0) this.rpc("public/subscribe", { channels: added.map((s) => this.channelFor(s)) });
    return added;
  }

  /** Remove instruments; returns the ones that were subscribed. */
  unsubscribe(symbols: readonly string[]): string[] {
    const removed: string[] = [];
    for (const symbol of symbols) {
      if (this.wanted.delete(symbol)) removed.push(symbol);
    }
    if (removed.length > 0) this.rpc("public/unsubscribe", { channels: removed.map((s) => this.channelFor(s)) });
    return removed;
  }

  /** Subscribe the index price channel of a price index ("btc_usd"); kept like the instruments and replayed on every open. */
  subscribeIndex(indexName: string): void {
    if (this.indexes.has(indexName)) return;
    this.indexes.add(indexName);
    this.rpc("public/subscribe", { channels: [indexChannel(indexName)] });
  }

  private channelFor(symbol: string): string {
    return `ticker.${symbol}.${this.interval}`;
  }

  /** Sends only on an open socket (ids are allocated for frames that go out); queued work is replayed by onSocketOpen. */
  private rpc(method: string, params: Record<string, unknown>): void {
    if (!this.isOpen) return;
    this.send({ jsonrpc: "2.0", id: this.nextId++, method, params });
  }

  protected onSocketOpen(): void {
    this.rpc("public/set_heartbeat", { interval: DERIBIT_HEARTBEAT_INTERVAL_S });
    const channels = [...[...this.wanted].map((s) => this.channelFor(s)), ...[...this.indexes].map(indexChannel)];
    if (channels.length > 0) this.rpc("public/subscribe", { channels });
  }

  protected onSocketMessage(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.emit("error", new VenueSchemaError("deribit", "ws frame", [`frame is not JSON: ${data.slice(0, 120)}`]));
      return;
    }
    const reply = RawRpcReply.safeParse(json);
    if (reply.success) {
      this.handleReply(reply.data);
      return;
    }
    const notification = RawRpcNotification.safeParse(json);
    if (!notification.success) return; // not a frame we consume
    if (notification.data.method === "heartbeat") {
      const hb = RawHeartbeatParams.safeParse(notification.data.params);
      if (!hb.success) return;
      if (hb.data.type === "test_request") this.rpc("public/test", {});
      this.emit("heartbeat", { type: hb.data.type });
      return;
    }
    if (notification.data.method !== "subscription") return;
    const sub = RawSubscriptionParams.safeParse(notification.data.params);
    if (!sub.success) return;
    if (sub.data.channel.startsWith("ticker.")) {
      const ticker = RawTicker.safeParse(sub.data.data);
      if (ticker.success) this.emit("ticker", ticker.data);
      else this.emit("error", new VenueSchemaError("deribit", sub.data.channel, [`ticker frame rejected: ${ticker.error.issues[0]?.message ?? "invalid"}`]));
      return;
    }
    if (sub.data.channel.startsWith("deribit_price_index.")) {
      const index = RawIndexNotification.safeParse(sub.data.data);
      if (index.success) this.emit("index", { name: index.data.index_name, price: index.data.price, ts: index.data.timestamp });
    }
  }

  private handleReply(reply: RawRpcReply): void {
    if (reply.error) {
      this.emit("error", new VenueWsError(`Deribit refused request ${reply.id ?? "(no id)"}: ${reply.error.code} ${reply.error.message}`, reply.error));
      return;
    }
    // a subscribe / unsubscribe answers with the channel list; other replies (heartbeat ok, test version) carry nothing the session needs
    const channels = Array.isArray(reply.result) ? reply.result.filter((c): c is string => typeof c === "string") : [];
    if (channels.length > 0) this.emit("subscriptions", channels);
  }
}

function indexChannel(indexName: string): string {
  return `deribit_price_index.${indexName}`;
}

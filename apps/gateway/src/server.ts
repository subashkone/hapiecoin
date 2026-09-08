/**
 * GatewayServer: HTTP (`/healthz`, `/metrics`) plus the WebSocket protocol from `@hapiecoin/schema`
 * (`ClientMessage` in, `ServerMessage` out), on top of a pluggable transport.
 *
 * Per connection: the topic set (bounded by MAX_TOPICS_PER_CONN), the last `seq` seen per topic, an
 * invalid-message strike count (3 strikes close the socket with 1008) and the set of topics that were
 * dropped while the socket's send buffer was over MAX_BUFFERED_BYTES; those topics get a fresh `snap`
 * once the buffer drains (checked on the next frame for that topic and by a sweep every COALESCE_MS).
 *
 * Frames are JSON text (see ./encoder.ts for the msgpack plan).
 */
import { ClientMessage, parseTopic } from "@hapiecoin/schema";
import type { ParsedTopic, ServerMessage, Topic, Underlying } from "@hapiecoin/schema";
import type { GatewayConfig } from "./config.js";
import type { FrameEncoder } from "./encoder.js";
import { jsonEncoder } from "./encoder.js";
import type { FeedStatus, Snapshot, SpotState } from "./feed/feed.js";
import type { Logger } from "./log.js";
import { silentLogger } from "./log.js";
import type { PubSub } from "./pubsub/types.js";
import type {
  Connection,
  HttpRequest,
  HttpResponse,
  SocketServer,
  SocketServerFactory,
  TransportHandlers,
  UpgradeRequest,
} from "./transport/types.js";

/** What the server needs from MarketFeed (an interface so tests can drive it with a stub). */
export interface FeedLike {
  status(): FeedStatus;
  supports(topic: Topic): boolean;
  seq(topic: Topic): number;
  snapshot(topic: Topic): Snapshot | null;
  spot(underlying: Underlying): SpotState | null;
  acquire(topic: Topic): void;
  release(topic: Topic): void;
}

export type ServerConfig = Pick<
  GatewayConfig,
  "NODE_ENV" | "WEB_URL" | "MAX_TOPICS_PER_CONN" | "MAX_BUFFERED_BYTES" | "COALESCE_MS" | "MAX_CONNECTIONS_PER_IP"
> & { METRICS_TOKEN?: string | undefined };

export interface GatewayServerOptions {
  config: ServerConfig;
  feed: FeedLike;
  pubsub: PubSub;
  transport: SocketServerFactory;
  encoder?: FrameEncoder;
  log?: Logger;
  now?: () => number;
}

/** Invalid inbound messages tolerated before the connection is closed with 1008. */
export const MAX_STRIKES = 3;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** One subscribed topic of one connection; `subscribe` receives the instance so the pubsub handler can refer to it. */
class Subscription {
  readonly unsubscribe: () => void;
  constructor(
    readonly topic: Topic,
    readonly parsed: Extract<ParsedTopic, { kind: "chain" | "spot" }>,
    subscribe: (self: Subscription) => () => void,
  ) {
    this.unsubscribe = subscribe(this);
  }
}

interface ConnState {
  conn: Connection;
  topics: Map<Topic, Subscription>;
  seq: Map<Topic, number>;
  strikes: number;
  /** Subscriptions whose frames were dropped under backpressure; each gets a resync once the buffer drains. */
  stalled: Set<Subscription>;
  openedAt: number;
}

export class GatewayServer {
  readonly handlers: TransportHandlers;
  private readonly config: ServerConfig;
  private readonly feed: FeedLike;
  private readonly pubsub: PubSub;
  private readonly encoder: FrameEncoder;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly socket: SocketServer;
  private readonly conns = new Map<number, ConnState>();
  private readonly allowedOrigin: string;
  private readonly startedAt: number;
  private sentTotal = 0;
  private droppedTotal = 0;
  private lastScrapeAt: number;
  private lastScrapeSent = 0;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(options: GatewayServerOptions) {
    this.config = options.config;
    this.feed = options.feed;
    this.pubsub = options.pubsub;
    this.encoder = options.encoder ?? jsonEncoder;
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? Date.now;
    this.allowedOrigin = new URL(this.config.WEB_URL).origin;
    this.startedAt = this.now();
    this.lastScrapeAt = this.startedAt;
    this.handlers = {
      http: (request) => this.onHttp(request),
      upgrade: (request) => this.onUpgrade(request),
      open: (conn) => this.onOpen(conn),
      message: (conn, data) => this.onMessage(conn, data),
      close: (conn, code, reason) => this.onClose(conn, code, reason),
    };
    this.socket = options.transport(this.handlers);
  }

  async listen(port: number, host: string): Promise<number> {
    const bound = await this.socket.listen(port, host);
    this.sweep = setInterval(() => this.recoverStalled(), this.config.COALESCE_MS);
    return bound;
  }

  /** Release every topic, close every connection with 1001 and stop listening. */
  async close(): Promise<void> {
    if (this.sweep !== null) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
    for (const state of [...this.conns.values()]) {
      this.teardown(state);
      state.conn.close(1001, "server shutdown");
    }
    await this.socket.close();
  }

  connectionCount(): number {
    return this.conns.size;
  }

  /** Prometheus text exposition (0.0.4). Message rate is measured between scrapes. */
  metrics(): string {
    const now = this.now();
    const elapsedS = Math.max(0.001, (now - this.lastScrapeAt) / 1000);
    const rate = (this.sentTotal - this.lastScrapeSent) / elapsedS;
    this.lastScrapeAt = now;
    this.lastScrapeSent = this.sentTotal;
    let subscriptions = 0;
    for (const state of this.conns.values()) subscriptions += state.topics.size;
    const feed = this.feed.status();
    return [
      "# TYPE hapiecoin_gateway_connections gauge",
      `hapiecoin_gateway_connections ${this.conns.size}`,
      "# TYPE hapiecoin_gateway_topics gauge",
      `hapiecoin_gateway_topics ${this.pubsub.topicCount()}`,
      "# TYPE hapiecoin_gateway_subscriptions gauge",
      `hapiecoin_gateway_subscriptions ${subscriptions}`,
      "# TYPE hapiecoin_gateway_messages_sent_total counter",
      `hapiecoin_gateway_messages_sent_total ${this.sentTotal}`,
      "# TYPE hapiecoin_gateway_messages_dropped_total counter",
      `hapiecoin_gateway_messages_dropped_total ${this.droppedTotal}`,
      "# TYPE hapiecoin_gateway_messages_per_second gauge",
      `hapiecoin_gateway_messages_per_second ${rate.toFixed(3)}`,
      "# TYPE hapiecoin_gateway_feed_ready gauge",
      `hapiecoin_gateway_feed_ready ${feed.ready ? 1 : 0}`,
      "# TYPE hapiecoin_gateway_feed_instruments gauge",
      `hapiecoin_gateway_feed_instruments ${feed.market.instruments}`,
      "# TYPE hapiecoin_gateway_feed_upstream_symbols gauge",
      `hapiecoin_gateway_feed_upstream_symbols ${feed.market.subscribed}`,
      "",
    ].join("\n");
  }

  private onHttp(request: HttpRequest): HttpResponse {
    const path = request.url.replace(/\?.*$/, "");
    const origin = request.headers.origin;
    // Browsers read /healthz for the expiry list; answer CORS only for the allowed web origin.
    const cors: Record<string, string> =
      origin !== undefined && this.isOriginAllowed(origin)
        ? { "access-control-allow-origin": origin, vary: "origin" }
        : {};
    if (request.method === "OPTIONS") {
      return {
        status: 204,
        contentType: "text/plain",
        body: "",
        headers: { ...cors, "access-control-allow-methods": "GET", "access-control-max-age": "600" },
      };
    }
    if (request.method !== "GET") {
      return {
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ error: "method not allowed" }),
        headers: cors,
      };
    }
    if (path === "/healthz") {
      const feed = this.feed.status();
      const body = {
        ok: feed.ready,
        status: feed.ready ? "ok" : "starting",
        uptimeMs: this.now() - this.startedAt,
        connections: this.conns.size,
        encoder: this.encoder.name,
        feed,
      };
      return {
        status: feed.ready ? 200 : 503,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: cors,
      };
    }
    if (path === "/metrics") {
      const token = this.config.METRICS_TOKEN;
      if (token !== undefined && request.headers["authorization"] !== `Bearer ${token}`) {
        return { status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }), headers: { ...cors, "www-authenticate": "Bearer" } };
      }
      return {
        status: 200,
        contentType: "text/plain; version=0.0.4; charset=utf-8",
        body: this.metrics(),
        headers: cors,
      };
    }
    return {
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found" }),
      headers: cors,
    };
  }

  private onUpgrade(request: UpgradeRequest): boolean {
    const allowed = this.isOriginAllowed(request.headers.origin);
    if (!allowed)
      this.log.warn("upgrade refused", { origin: request.headers.origin, remote: request.remoteAddress });
    return allowed;
  }

  /** No Origin (non-browser clients) is allowed; browsers must come from WEB_URL, or localhost outside production. */
  private isOriginAllowed(origin: string | undefined): boolean {
    if (origin === undefined) return true;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (url.origin === this.allowedOrigin) return true;
    return this.config.NODE_ENV !== "production" && LOCAL_HOSTS.has(url.hostname);
  }

  private onOpen(conn: Connection): void {
    const sameAddress = [...this.conns.values()].filter((s) => s.conn.remoteAddress === conn.remoteAddress).length;
    if (sameAddress >= this.config.MAX_CONNECTIONS_PER_IP) {
      this.log.warn("connection refused: per-address cap", { remote: conn.remoteAddress, open: sameAddress });
      conn.close(1013, `at most ${this.config.MAX_CONNECTIONS_PER_IP} connections per address`);
      return;
    }
    this.conns.set(conn.id, {
      conn,
      topics: new Map(),
      seq: new Map(),
      strikes: 0,
      stalled: new Set(),
      openedAt: this.now(),
    });
    this.log.debug("connection open", { id: conn.id, remote: conn.remoteAddress });
  }

  private onMessage(conn: Connection, data: string): void {
    const state = this.conns.get(conn.id);
    if (!state) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.strike(state, "invalid_json", "frame is not JSON");
      return;
    }
    const parsed = ClientMessage.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      this.strike(state, "invalid_message", detail);
      return;
    }
    const message = parsed.data;
    switch (message.op) {
      case "ping":
        this.send(state, { t: "pong" });
        return;
      case "sub":
        this.subscribe(state, message.topics);
        return;
      case "unsub":
        this.unsubscribe(state, message.topics);
        return;
    }
  }

  private onClose(conn: Connection, code: number, reason: string): void {
    const state = this.conns.get(conn.id);
    if (!state) return;
    this.teardown(state);
    this.log.debug("connection closed", { id: conn.id, code, reason, openMs: this.now() - state.openedAt });
  }

  private teardown(state: ConnState): void {
    for (const [topic, subscription] of state.topics) {
      subscription.unsubscribe();
      this.feed.release(topic);
    }
    state.topics.clear();
    state.seq.clear();
    state.stalled.clear();
    this.conns.delete(state.conn.id);
  }

  private strike(state: ConnState, code: string, message: string): void {
    state.strikes += 1;
    this.send(state, { t: "err", code, message });
    if (state.strikes >= MAX_STRIKES) {
      this.log.warn("closing after invalid messages", { id: state.conn.id, strikes: state.strikes });
      state.conn.close(1008, "too many invalid messages");
    }
  }

  private subscribe(state: ConnState, topics: readonly Topic[]): void {
    for (const topic of topics) {
      if (state.topics.has(topic)) continue;
      if (!this.feed.supports(topic)) {
        this.send(state, {
          t: "err",
          code: "unsupported_topic",
          message: `${topic} is not served by this gateway yet`,
        });
        continue;
      }
      if (state.topics.size >= this.config.MAX_TOPICS_PER_CONN) {
        this.send(state, {
          t: "err",
          code: "topic_limit",
          message: `at most ${this.config.MAX_TOPICS_PER_CONN} topics per connection; ${topic} was not subscribed`,
        });
        return;
      }
      // supports() already rejected every unparsable or fut topic, so this is a chain or spot topic
      const parsed = parseTopic(topic) as Subscription["parsed"];
      this.feed.acquire(topic);
      if (parsed.kind === "chain") {
        const snapshot = this.feed.snapshot(topic);
        if (snapshot === null) {
          this.feed.release(topic);
          this.send(state, {
            t: "err",
            code: "unknown_topic",
            message: `${topic}: no such expiry in the instrument list`,
          });
          continue;
        }
        state.topics.set(topic, this.track(state, topic, parsed));
        this.sendSnapshot(state, topic, snapshot);
      } else {
        state.topics.set(topic, this.track(state, topic, parsed));
        const spot = this.feed.spot(parsed.underlying);
        if (spot !== null) this.send(state, { t: "spot", s: parsed.underlying, p: spot.p });
      }
    }
  }

  private track(state: ConnState, topic: Topic, parsed: Subscription["parsed"]): Subscription {
    return new Subscription(topic, parsed, (self) =>
      this.pubsub.subscribe(topic, (message) => this.deliver(state, self, message)),
    );
  }

  private unsubscribe(state: ConnState, topics: readonly Topic[]): void {
    for (const topic of topics) {
      const subscription = state.topics.get(topic);
      if (!subscription) continue;
      subscription.unsubscribe();
      this.feed.release(topic);
      state.topics.delete(topic);
      state.seq.delete(topic);
      state.stalled.delete(subscription);
    }
  }

  private deliver(state: ConnState, subscription: Subscription, message: ServerMessage): void {
    if (!state.conn.isOpen) return;
    if (state.conn.bufferedAmount() > this.config.MAX_BUFFERED_BYTES) {
      state.stalled.add(subscription);
      this.droppedTotal += 1;
      return;
    }
    if (state.stalled.has(subscription)) {
      state.stalled.delete(subscription);
      this.resync(state, subscription);
      return;
    }
    this.send(state, message);
    if (message.t === "q") state.seq.set(subscription.topic, message.seq);
  }

  /** After a stall, replace whatever was dropped with the current state of the topic. */
  private resync(state: ConnState, subscription: Subscription): void {
    const { topic, parsed } = subscription;
    if (parsed.kind === "chain") {
      const snapshot = this.feed.snapshot(topic);
      if (snapshot !== null) this.sendSnapshot(state, topic, snapshot);
    } else {
      const spot = this.feed.spot(parsed.underlying);
      if (spot !== null) this.send(state, { t: "spot", s: parsed.underlying, p: spot.p });
    }
  }

  private recoverStalled(): void {
    for (const state of this.conns.values()) {
      if (state.stalled.size === 0 || !state.conn.isOpen) continue;
      if (state.conn.bufferedAmount() > this.config.MAX_BUFFERED_BYTES) continue;
      const subscriptions = [...state.stalled];
      state.stalled.clear();
      for (const subscription of subscriptions) this.resync(state, subscription);
    }
  }

  private sendSnapshot(state: ConnState, topic: Topic, snapshot: Snapshot): void {
    this.send(state, { t: "snap", topic, seq: snapshot.seq, rows: snapshot.rows });
    state.seq.set(topic, snapshot.seq);
  }

  private send(state: ConnState, message: ServerMessage): void {
    state.conn.send(this.encoder.encode(message));
    this.sentTotal += 1;
  }
}

// One WebSocket per tab to apps/gateway. Frames are validated with @hapiecoin/schema before use
// (typescript rule 2). Reconnects with exponential backoff and resubscribes to every live topic; a chain
// topic always gets a fresh `snap` after resubscribe, which also heals seq gaps (reducer `stale`).
import { ServerMessage, parseTopic, type ClientMessage, type Topic, type Underlying } from "@hapiecoin/schema";
import {
  applyServerMessage,
  applySpot,
  emptyChain,
  type ChainState,
  type SpotState,
} from "./reducer";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface GatewayEvents {
  status: (status: ConnectionStatus) => void;
  chain: (topic: string, state: ChainState) => void;
  spot: (underlying: Underlying, state: SpotState) => void;
  latency: (ms: number) => void;
  error: (code: string, message: string) => void;
}

/** Minimal WebSocket surface so tests can inject a fake. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface GatewayClientOptions {
  url: string;
  createSocket?: WebSocketFactory;
  /** Backoff base / cap in ms (defaults 500 → 15 000). */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Ping interval used for the latency readout (ms). 0 disables. */
  pingIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const WS_OPEN = 1;

export class GatewayClient {
  private readonly opts: Required<Omit<GatewayClientOptions, "createSocket">> & { createSocket: WebSocketFactory };
  private socket: WebSocketLike | null = null;
  private status: ConnectionStatus = "idle";
  private attempts = 0;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;
  private pingSentAt = 0;
  private manuallyClosed = false;
  /** topic → subscriber count. */
  private readonly refs = new Map<string, number>();
  private readonly chains = new Map<string, ChainState>();
  private readonly spots = new Map<Underlying, SpotState>();
  private readonly listeners: { [K in keyof GatewayEvents]: Set<GatewayEvents[K]> } = {
    status: new Set(),
    chain: new Set(),
    spot: new Set(),
    latency: new Set(),
    error: new Set(),
  };
  private lastLatency = 0;

  constructor(options: GatewayClientOptions) {
    this.opts = {
      url: options.url,
      createSocket:
        options.createSocket ??
        ((url) => new WebSocket(url) as unknown as WebSocketLike),
      backoffBaseMs: options.backoffBaseMs ?? 500,
      backoffMaxMs: options.backoffMaxMs ?? 15_000,
      pingIntervalMs: options.pingIntervalMs ?? 5_000,
      now: options.now ?? (() => Date.now()),
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
  getLatency(): number {
    return this.lastLatency;
  }
  getChain(topic: string): ChainState | undefined {
    return this.chains.get(topic);
  }
  getSpot(underlying: Underlying): SpotState | undefined {
    return this.spots.get(underlying);
  }
  /** Topics with at least one subscriber. */
  topics(): string[] {
    return [...this.refs.keys()];
  }

  on<K extends keyof GatewayEvents>(event: K, fn: GatewayEvents[K]): () => void {
    const set = this.listeners[event] as Set<GatewayEvents[K]>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof GatewayEvents>(event: K, ...args: Parameters<GatewayEvents[K]>) {
    for (const fn of this.listeners[event] as Set<(...a: Parameters<GatewayEvents[K]>) => void>) fn(...args);
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  connect(): void {
    if (this.socket || this.manuallyClosed) return;
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    let ws: WebSocketLike;
    try {
      ws = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("open");
      this.resubscribe();
      this.startPing();
    };
    ws.onmessage = (ev) => this.handleFrame(ev.data);
    ws.onerror = () => {
      /* onclose follows; nothing to do */
    };
    ws.onclose = () => {
      this.stopPing();
      this.socket = null;
      if (this.manuallyClosed) {
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** Close for good (page unload / tests). Subscriptions are kept so a later connect() resubscribes. */
  close(): void {
    this.manuallyClosed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      this.opts.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const s = this.socket;
    this.socket = null;
    if (s) s.close(1000, "client closed");
    this.setStatus("closed");
  }

  /** Reopen after close() (feed "reconnect" click). */
  reopen(): void {
    this.manuallyClosed = false;
    this.attempts = 0;
    this.connect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.setStatus("reconnecting");
    const delay = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = this.opts.setTimer(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Delay the next reconnect would use (exposed for tests). */
  nextBackoffMs(): number {
    return Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** this.attempts);
  }

  private send(msg: ClientMessage) {
    const s = this.socket;
    if (!s || s.readyState !== WS_OPEN) return false;
    s.send(JSON.stringify(msg));
    return true;
  }

  subscribe(topic: Topic): () => void {
    const n = this.refs.get(topic) ?? 0;
    this.refs.set(topic, n + 1);
    if (n === 0) {
      if (parseTopic(topic)?.kind === "chain" && !this.chains.has(topic)) this.chains.set(topic, emptyChain(topic));
      this.send({ op: "sub", topics: [topic] });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.unsubscribe(topic);
    };
  }

  private unsubscribe(topic: Topic) {
    const n = this.refs.get(topic) ?? 0;
    if (n <= 1) {
      this.refs.delete(topic);
      this.send({ op: "unsub", topics: [topic] });
      if (parseTopic(topic)?.kind === "chain") this.chains.delete(topic);
    } else {
      this.refs.set(topic, n - 1);
    }
  }

  /** Ask the gateway for a fresh snapshot of a chain (after a seq gap). */
  refresh(topic: Topic): void {
    if (!this.refs.has(topic)) return;
    this.send({ op: "unsub", topics: [topic] });
    this.send({ op: "sub", topics: [topic] });
  }

  private resubscribe() {
    const topics = [...this.refs.keys()];
    if (!topics.length) return;
    for (let i = 0; i < topics.length; i += 200) {
      this.send({ op: "sub", topics: topics.slice(i, i + 200) });
    }
  }

  private startPing() {
    if (!this.opts.pingIntervalMs) return;
    const tick = () => {
      this.pingSentAt = this.opts.now();
      this.send({ op: "ping" });
      this.pingTimer = this.opts.setTimer(tick, this.opts.pingIntervalMs);
    };
    tick();
  }
  private stopPing() {
    if (this.pingTimer !== null) {
      this.opts.clearTimer(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Parse and apply one frame; invalid frames are ignored (and reported as an error event). */
  handleFrame(raw: unknown): void {
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      this.emit("error", "BAD_JSON", "gateway sent a frame that is not JSON");
      return;
    }
    const parsed = ServerMessage.safeParse(json);
    if (!parsed.success) {
      this.emit("error", "BAD_FRAME", "gateway sent a frame that does not match the schema");
      return;
    }
    const msg = parsed.data;
    const now = this.opts.now();
    switch (msg.t) {
      case "snap":
      case "q": {
        const prev = this.chains.get(msg.topic);
        if (!prev) return;
        const next = applyServerMessage(prev, msg, now);
        this.chains.set(msg.topic, next);
        if (next.stale) this.refresh(msg.topic);
        this.emit("chain", msg.topic, next);
        break;
      }
      case "spot": {
        const next = applySpot(this.spots.get(msg.s), msg.p, msg.c24, now);
        this.spots.set(msg.s, next);
        this.emit("spot", msg.s, next);
        break;
      }
      case "pong": {
        if (this.pingSentAt) {
          this.lastLatency = Math.max(0, now - this.pingSentAt);
          this.emit("latency", this.lastLatency);
        }
        break;
      }
      case "err":
        this.emit("error", msg.code, msg.message);
        break;
    }
  }
}

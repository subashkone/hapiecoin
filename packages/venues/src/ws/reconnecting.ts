/**
 * Reconnecting WebSocket base shared by the Delta and Binance clients.
 *
 * - WebSocket constructor is injectable (tests use a fake; production uses globalThis.WebSocket,
 *   available in Node 22+ and browsers).
 * - Exponential backoff with optional jitter; `close()` stops reconnecting for good.
 * - Liveness watchdog: if no frame arrives within `heartbeatMs`, the socket is dropped and a
 *   reconnect is scheduled (Delta docs: reconnect when no heartbeat in 35 s).
 */
import { Emitter } from "../emitter.js";
import { StaleConnectionError } from "../errors.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export const WS_OPEN = 1;

export interface BackoffOptions {
  /** Delay before the first reconnect attempt (default 1000 ms). */
  initialMs: number;
  /** Upper bound on the delay (default 30000 ms). */
  maxMs: number;
  /** Multiplier per attempt (default 2). */
  factor: number;
  /** Returns 0..1; the delay is scaled by (1 + jitter() * jitterRatio). Default: no jitter (deterministic tests). */
  jitter: () => number;
  /** Maximum extra fraction added by jitter (default 0.25). */
  jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitter: () => 0,
  jitterRatio: 0.25,
};

/** Delay for reconnect attempt `attempt` (1-based). */
export function backoffDelay(attempt: number, options: BackoffOptions = DEFAULT_BACKOFF): number {
  const base = Math.min(options.maxMs, options.initialMs * options.factor ** Math.max(0, attempt - 1));
  const jitter = Math.min(1, Math.max(0, options.jitter()));
  return Math.round(base * (1 + jitter * options.jitterRatio));
}

export type SocketState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface CloseInfo {
  code: number;
  reason: string;
  /** True when the client will try to reconnect. */
  willReconnect: boolean;
}

export interface ReconnectInfo {
  /** 1-based reconnect attempt number. */
  attempt: number;
  delayMs: number;
}

export interface BaseSocketEvents extends Record<string, unknown> {
  open: undefined;
  close: CloseInfo;
  error: Error;
  reconnect: ReconnectInfo;
}

export interface ReconnectingSocketOptions {
  url: string;
  WebSocket?: WebSocketCtor;
  backoff?: Partial<BackoffOptions>;
  /** Liveness window in ms; 0 disables the watchdog. */
  heartbeatMs?: number;
}

function resolveCtor(ctor: WebSocketCtor | undefined): WebSocketCtor {
  if (ctor) return ctor;
  const globalCtor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!globalCtor) throw new Error("No WebSocket implementation available; pass options.WebSocket");
  return globalCtor;
}

export abstract class ReconnectingSocket<Events extends BaseSocketEvents> extends Emitter<Events> {
  readonly url: string;
  protected readonly backoff: BackoffOptions;
  protected readonly heartbeatMs: number;
  private readonly ctor: WebSocketCtor;
  private ws: WebSocketLike | null = null;
  private stateValue: SocketState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(options: ReconnectingSocketOptions) {
    super();
    this.url = options.url;
    this.ctor = resolveCtor(options.WebSocket);
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.heartbeatMs = options.heartbeatMs ?? 0;
  }

  get state(): SocketState {
    return this.stateValue;
  }

  /** Reconnect attempts made since the last successful open. */
  get attempt(): number {
    return this.reconnectAttempt;
  }

  get isOpen(): boolean {
    return this.stateValue === "open" && this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  /** Open the socket. No-op if already connecting/open; a closed client can be reopened. */
  connect(): void {
    if (this.stateValue === "connecting" || this.stateValue === "open") return;
    this.clearReconnectTimer();
    this.stateValue = "connecting";
    this.openSocket();
  }

  /** Close for good: stops reconnecting, drops the socket, keeps listeners until removed. */
  close(): void {
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    const ws = this.ws;
    this.ws = null;
    const wasOpen = this.stateValue === "open";
    this.stateValue = "closed";
    if (ws) {
      try {
        ws.close(1000, "client closed");
      } catch {
        // an already-dead socket may throw; nothing to do
      }
    }
    if (wasOpen) this.emit("close", { code: 1000, reason: "client closed", willReconnect: false });
  }

  protected send(payload: unknown): boolean {
    if (!this.isOpen || !this.ws) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /** Called on the socket's `open`. Subclasses send auth/heartbeat/subscriptions here. */
  protected abstract onSocketOpen(): void;

  /** Called for each text frame. */
  protected abstract onSocketMessage(data: string): void;

  /** Reset the liveness watchdog (called for every frame; subclasses may call it explicitly). */
  protected touchHeartbeat(): void {
    if (this.heartbeatMs <= 0 || this.stateValue !== "open") return;
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => this.onStale(), this.heartbeatMs);
  }

  private openSocket(): void {
    let ws: WebSocketLike;
    try {
      ws = new this.ctor(this.url);
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect(1006, "constructor failed");
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.stateValue = "open";
      this.reconnectAttempt = 0;
      this.emit("open", undefined);
      this.touchHeartbeat();
      this.onSocketOpen();
    });
    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) return;
      this.touchHeartbeat();
      const data = event.data;
      this.onSocketMessage(typeof data === "string" ? data : String(data));
    });
    ws.addEventListener("error", (event) => {
      if (this.ws !== ws) return;
      const message =
        event instanceof Error ? event.message : ((event as { message?: string } | null)?.message ?? "socket error");
      this.emit("error", new Error(message));
    });
    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearHeartbeatTimer();
      this.scheduleReconnect(event.code ?? 1006, event.reason ?? "");
    });
  }

  private onStale(): void {
    const ws = this.ws;
    this.ws = null; // ignore any late events from the dead socket
    this.emit("error", new StaleConnectionError(this.heartbeatMs));
    if (ws) {
      try {
        ws.close(4000, "stale");
      } catch {
        // ignore
      }
    }
    this.scheduleReconnect(4000, "stale");
  }

  private scheduleReconnect(code: number, reason: string): void {
    this.stateValue = "reconnecting";
    this.reconnectAttempt += 1;
    const delayMs = backoffDelay(this.reconnectAttempt, this.backoff);
    this.emit("close", { code, reason, willReconnect: true });
    this.emit("reconnect", { attempt: this.reconnectAttempt, delayMs });
    // A listener may call close() re-entrantly during those emits; honour it and arm no timer.
    if ((this.stateValue as SocketState) === "closed") return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.stateValue = "connecting";
      this.openSocket();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

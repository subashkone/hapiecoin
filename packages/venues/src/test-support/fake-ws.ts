/** Fake WebSocket for unit tests: records sent frames and lets tests drive open/message/close/error. */
import type { WebSocketLike } from "../ws/reconnecting.js";

type Handler = (event: unknown) => void;

export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  /** When true the constructor throws (simulates an environment without sockets / bad URL). */
  static failConstruct = false;
  /** When true `close()` throws (simulates a dead native socket). */
  static failClose = false;

  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  readonly closeCalls: { code: number | undefined; reason: string | undefined }[] = [];
  private readonly handlers = new Map<string, Handler[]>();

  constructor(url: string) {
    if (FakeWebSocket.failConstruct) throw new Error("fake constructor failure");
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.failConstruct = false;
    FakeWebSocket.failClose = false;
  }

  static get last(): FakeWebSocket {
    const last = FakeWebSocket.instances.at(-1);
    if (!last) throw new Error("no FakeWebSocket instance");
    return last;
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener as Handler);
    this.handlers.set(type, list);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("send on a socket that is not open");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (FakeWebSocket.failClose) throw new Error("fake close failure");
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  /** Parsed copies of every frame sent. */
  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.fire("open", undefined);
  }

  /** Objects are JSON-encoded; strings are delivered verbatim (use for malformed frames). */
  simulateMessage(data: unknown): void {
    this.fire("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  /** Deliver a non-string payload untouched (binary frame simulation). */
  simulateRawMessage(data: unknown): void {
    this.fire("message", { data });
  }

  simulateClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.fire("close", { code, reason });
  }

  /** Close event without code/reason (some implementations omit them). */
  simulateBareClose(): void {
    this.readyState = 3;
    this.fire("close", {});
  }

  simulateError(event: unknown): void {
    this.fire("error", event);
  }

  private fire(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

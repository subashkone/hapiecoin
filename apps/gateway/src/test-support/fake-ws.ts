/** Minimal fake of the browser/Node WebSocket used by @hapiecoin/venues (records frames; tests drive events). */
import type { WebSocketLike } from "@hapiecoin/venues";

type Handler = (event: unknown) => void;

export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, Handler[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
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
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.fire("open", undefined);
  }

  simulateMessage(data: unknown): void {
    this.fire("message", { data: JSON.stringify(data) });
  }

  private fire(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

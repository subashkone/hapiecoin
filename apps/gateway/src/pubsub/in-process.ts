import type { ServerMessage } from "@hapiecoin/schema";
import type { PubSub, PubSubHandler } from "./types.js";

/** Single-process fan-out: handlers are called synchronously in subscription order. */
export class InProcessPubSub implements PubSub {
  private readonly handlers = new Map<string, Set<PubSubHandler>>();

  publish(topic: string, message: ServerMessage): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of [...set]) handler(message);
  }

  subscribe(topic: string, handler: PubSubHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(topic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(topic);
    };
  }

  topicCount(): number {
    return this.handlers.size;
  }

  close(): Promise<void> {
    this.handlers.clear();
    return Promise.resolve();
  }
}

import type { ServerMessage } from "@hapiecoin/schema";

export type PubSubHandler = (message: ServerMessage) => void;

/**
 * Topic fan-out between the feed (publisher) and connections (subscribers).
 * `publish` is fire-and-forget; delivery order per topic is preserved by every implementation.
 */
export interface PubSub {
  publish(topic: string, message: ServerMessage): void;
  /** Register a handler; returns a function that removes it (safe to call twice). */
  subscribe(topic: string, handler: PubSubHandler): () => void;
  /** Distinct topics with at least one handler (metrics). */
  topicCount(): number;
  close(): Promise<void>;
}

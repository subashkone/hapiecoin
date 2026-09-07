/**
 * Redis pub/sub fan-out (ioredis). Used only when `REDIS_URL` is set. One connection publishes, a second
 * one subscribes (a subscribed Redis connection cannot issue other commands). Frames travel as JSON.
 *
 * Deployment note: every gateway process runs its own Delta feed, so with several processes behind one
 * Redis each frame would be published once per process. Run a single feed process (or one gateway) per
 * Redis until a feed-leader election is added; that is a Phase 2 item, not a Phase 1 one.
 */
import type { ServerMessage } from "@hapiecoin/schema";
import Redis from "ioredis";
import type { PubSub, PubSubHandler } from "./types.js";

/** The slice of ioredis this class uses; tests pass a fake through `createClient`. */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  quit(): Promise<unknown>;
}

export interface RedisPubSubOptions {
  url: string;
  /** Channel prefix so several environments can share one Redis (default "hapiecoin:gw:"). */
  prefix?: string;
  createClient?: (url: string) => RedisLike;
  /** Receives connection and (un)subscribe failures; default: ignore (the transport reconnects on its own). */
  onError?: (error: Error) => void;
}

function defaultCreateClient(url: string): RedisLike {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
}

export class RedisPubSub implements PubSub {
  private readonly pub: RedisLike;
  private readonly sub: RedisLike;
  private readonly prefix: string;
  private readonly onError: (error: Error) => void;
  private readonly handlers = new Map<string, Set<PubSubHandler>>();

  constructor(options: RedisPubSubOptions) {
    const create = options.createClient ?? defaultCreateClient;
    this.prefix = options.prefix ?? "hapiecoin:gw:";
    this.onError = options.onError ?? (() => undefined);
    this.pub = create(options.url);
    this.sub = create(options.url);
    this.pub.on("error", (error) => this.onError(error));
    this.sub.on("error", (error) => this.onError(error));
    this.sub.on("message", (channel, message) => this.deliver(channel, message));
  }

  publish(topic: string, message: ServerMessage): void {
    this.pub
      .publish(this.prefix + topic, JSON.stringify(message))
      .catch((error: unknown) => this.onError(toError(error)));
  }

  subscribe(topic: string, handler: PubSubHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      this.sub.subscribe(this.prefix + topic).catch((error: unknown) => this.onError(toError(error)));
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(topic);
      if (!current || !current.delete(handler)) return;
      if (current.size === 0) {
        this.handlers.delete(topic);
        this.sub.unsubscribe(this.prefix + topic).catch((error: unknown) => this.onError(toError(error)));
      }
    };
  }

  topicCount(): number {
    return this.handlers.size;
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  private deliver(channel: string, raw: string): void {
    if (!channel.startsWith(this.prefix)) return;
    const set = this.handlers.get(channel.slice(this.prefix.length));
    if (!set) return;
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch (error) {
      this.onError(toError(error));
      return;
    }
    for (const handler of [...set]) handler(message);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

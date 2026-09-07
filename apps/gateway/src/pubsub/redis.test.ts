import type { ServerMessage } from "@hapiecoin/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisPubSub } from "./redis.js";
import type { RedisLike } from "./redis.js";

const { FakeRedis } = vi.hoisted(() => {
  /** Fake ioredis: a shared in-memory broker so a "pub" client reaches every "sub" client. */
  class FakeRedis implements RedisLike {
    static clients: FakeRedis[] = [];
    /** true: reject with an Error; "raw": reject with a plain string (the non-Error path). */
    static failCommands: boolean | "raw" = false;
    readonly url: string;
    readonly channels = new Set<string>();
    readonly published: { channel: string; message: string }[] = [];
    quitCalls = 0;
    private readonly listeners = {
      message: [] as ((channel: string, message: string) => void)[],
      error: [] as ((e: Error) => void)[],
    };

    constructor(url: string) {
      this.url = url;
      FakeRedis.clients.push(this);
    }

    static reset(): void {
      FakeRedis.clients = [];
      FakeRedis.failCommands = false;
    }

    publish(channel: string, message: string): Promise<number> {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises RedisPubSub's non-Error rejection path
      if (FakeRedis.failCommands === "raw") return Promise.reject("publish failed raw");
      if (FakeRedis.failCommands) return Promise.reject(new Error("publish failed"));
      this.published.push({ channel, message });
      let delivered = 0;
      for (const client of FakeRedis.clients) {
        if (!client.channels.has(channel)) continue;
        delivered += 1;
        for (const listener of client.listeners.message) listener(channel, message);
      }
      return Promise.resolve(delivered);
    }

    subscribe(...channels: string[]): Promise<unknown> {
      if (FakeRedis.failCommands) return Promise.reject(new Error("subscribe failed"));
      for (const channel of channels) this.channels.add(channel);
      return Promise.resolve(channels.length);
    }

    unsubscribe(...channels: string[]): Promise<unknown> {
      if (FakeRedis.failCommands) return Promise.reject(new Error("unsubscribe failed"));
      for (const channel of channels) this.channels.delete(channel);
      return Promise.resolve(channels.length);
    }

    on(event: "message", listener: (channel: string, message: string) => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(
      event: "message" | "error",
      listener: ((channel: string, message: string) => void) | ((error: Error) => void),
    ): unknown {
      if (event === "message")
        this.listeners.message.push(listener as (channel: string, message: string) => void);
      else this.listeners.error.push(listener as (error: Error) => void);
      return this;
    }

    emitError(error: Error): void {
      for (const listener of this.listeners.error) listener(error);
    }

    /** Deliver a raw frame as if it came from the broker. */
    inject(channel: string, message: string): void {
      for (const listener of this.listeners.message) listener(channel, message);
    }

    quit(): Promise<unknown> {
      this.quitCalls += 1;
      return Promise.resolve("OK");
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({ default: FakeRedis }));

const SPOT: ServerMessage = { t: "spot", s: "BTC", p: "79521" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  FakeRedis.reset();
});

describe("[GATEWAY] redis pubsub (fake ioredis)", () => {
  it("[GATEWAY] publishes JSON on prefixed channels and delivers to local handlers", async () => {
    const errors: Error[] = [];
    const bus = new RedisPubSub({
      url: "redis://fake",
      createClient: (url) => new FakeRedis(url),
      onError: (e) => errors.push(e),
    });
    const [pub, sub] = FakeRedis.clients as [InstanceType<typeof FakeRedis>, InstanceType<typeof FakeRedis>];
    expect(pub.url).toBe("redis://fake");
    const seen: ServerMessage[] = [];
    const off = bus.subscribe("spot:BTC", (m) => seen.push(m));
    bus.subscribe("spot:BTC", (m) => seen.push(m));
    expect(sub.channels).toEqual(new Set(["hapiecoin:gw:spot:BTC"]));
    expect(bus.topicCount()).toBe(1);

    bus.publish("spot:BTC", SPOT);
    await flush();
    expect(pub.published).toEqual([{ channel: "hapiecoin:gw:spot:BTC", message: JSON.stringify(SPOT) }]);
    expect(seen).toEqual([SPOT, SPOT]);

    off();
    off();
    expect(sub.channels.size).toBe(1); // one handler left
    bus.publish("spot:BTC", SPOT);
    await flush();
    expect(seen).toHaveLength(3);

    // frames for other prefixes or channels without handlers are ignored; malformed JSON is reported
    sub.inject("other:spot:BTC", "{}");
    sub.inject("hapiecoin:gw:spot:ETH", "{}");
    sub.inject("hapiecoin:gw:spot:BTC", "{not json");
    expect(seen).toHaveLength(3);
    expect(errors.map((e) => e.name)).toEqual(["SyntaxError"]);

    pub.emitError(new Error("connection lost"));
    sub.emitError(new Error("subscriber lost"));
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/JSON/) as string,
      "connection lost",
      "subscriber lost",
    ]);

    await bus.close();
    expect(pub.quitCalls + sub.quitCalls).toBe(2);
    expect(bus.topicCount()).toBe(0);
  });

  it("[GATEWAY] unsubscribes the channel when the last handler leaves and reports command failures", async () => {
    const errors: Error[] = [];
    const bus = new RedisPubSub({
      url: "redis://fake",
      prefix: "t:",
      createClient: (url) => new FakeRedis(url),
      onError: (e) => errors.push(e),
    });
    const sub = FakeRedis.clients[1] as InstanceType<typeof FakeRedis>;
    const off = bus.subscribe("spot:BTC", () => undefined);
    expect(sub.channels).toEqual(new Set(["t:spot:BTC"]));
    off();
    await flush();
    expect(sub.channels.size).toBe(0);
    expect(bus.topicCount()).toBe(0);

    FakeRedis.failCommands = true;
    const off2 = bus.subscribe("spot:ETH", () => undefined);
    bus.publish("spot:ETH", SPOT);
    off2();
    await flush();
    expect(errors.map((e) => e.message).sort()).toEqual([
      "publish failed",
      "subscribe failed",
      "unsubscribe failed",
    ]);
    FakeRedis.failCommands = "raw";
    bus.publish("spot:ETH", SPOT);
    await flush();
    expect(errors.at(-1)).toBeInstanceOf(Error);
    expect(errors.at(-1)?.message).toBe("publish failed raw");
    FakeRedis.failCommands = false;
    await bus.close();
  });

  it("[GATEWAY] uses ioredis by default and swallows errors without an onError", async () => {
    const bus = new RedisPubSub({ url: "redis://default" });
    expect(FakeRedis.clients).toHaveLength(2);
    expect(FakeRedis.clients[0]?.url).toBe("redis://default");
    bus.subscribe("spot:BTC", () => undefined);
    (FakeRedis.clients[1] as InstanceType<typeof FakeRedis>).inject("hapiecoin:gw:spot:BTC", "{bad");
    FakeRedis.failCommands = true;
    bus.publish("spot:BTC", SPOT);
    bus.publish("spot:BTC", "not an error object" as unknown as ServerMessage);
    await flush();
    FakeRedis.failCommands = false;
    (FakeRedis.clients[0] as InstanceType<typeof FakeRedis>).emitError(new Error("ignored"));
    await bus.close();
  });
});

describe.skipIf(!process.env.REDIS_URL)("[GATEWAY] redis pubsub (integration, REDIS_URL set)", () => {
  it("[GATEWAY] round-trips a frame through a real Redis", async () => {
    vi.doUnmock("ioredis");
    const actual = await vi.importActual<{ default: new (url: string) => RedisLike }>("ioredis");
    const url = process.env.REDIS_URL as string;
    const bus = new RedisPubSub({
      url,
      prefix: `test:${process.pid}:`,
      createClient: (u) => new actual.default(u),
    });
    const received = new Promise<ServerMessage>((resolve) => bus.subscribe("spot:BTC", resolve));
    await new Promise((resolve) => setTimeout(resolve, 200));
    bus.publish("spot:BTC", SPOT);
    expect(await received).toEqual(SPOT);
    await bus.close();
  });
});

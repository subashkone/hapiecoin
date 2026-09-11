import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { InProcessPubSub } from "./pubsub/in-process.js";
import { RedisPubSub } from "./pubsub/redis.js";
import { FakeMarketData } from "./test-support/fake-market.js";
import { FakeRedis } from "./test-support/fake-redis.js";
import { createFakeTransport } from "./test-support/fake-transport.js";

vi.mock("ioredis", async () => ({ default: (await import("./test-support/fake-redis.js")).FakeRedis }));

describe("[GATEWAY] createApp", () => {
  it("[GATEWAY] wires config, feed, in-process pubsub and server; start binds then loads; stop tears down", async () => {
    const config = loadConfig({ GATEWAY_PORT: "0", LOG_LEVEL: "silent" });
    const transport = createFakeTransport(4321);
    const market = new FakeMarketData();
    const lines: string[] = [];
    const app = createApp(config, {
      transport: transport.factory,
      market,
      log: createLogger("info", (line) => lines.push(line)),
    });
    expect(app.pubsub).toBeInstanceOf(InProcessPubSub);
    expect(app.config).toBe(config);

    const port = await app.start();
    expect(port).toBe(4321);
    expect(transport.listening).toBe(true);
    expect(app.feed.status().ready).toBe(true);
    expect(market.socket).toBe("open");
    expect(lines.some((l) => l.includes("gateway listening") && l.includes('"pubsub":"in-process"'))).toBe(
      true,
    );

    const health = app.server.handlers.http({ method: "GET", url: "/healthz", headers: {} });
    expect(health.status).toBe(200);

    await app.stop();
    expect(transport.closed).toBe(true);
    expect(market.socket).toBe("closed");
    expect(lines.at(-1)).toContain("gateway stopped");
  });

  it("[GATEWAY] without injected deps it builds the real Delta market data and the ws transport (not started)", () => {
    const config = loadConfig({ LOG_LEVEL: "silent" });
    const pubsub = new InProcessPubSub();
    const app = createApp(config, { pubsub });
    expect(app.pubsub).toBe(pubsub);
    expect(app.feed.status()).toMatchObject({ ready: false, market: { instruments: 0, socket: "idle" } });
    expect(app.server.handlers.http({ method: "GET", url: "/healthz", headers: {} }).status).toBe(503);
  });

  it("[GATEWAY] with REDIS_URL the fan-out goes through RedisPubSub and its errors are logged", async () => {
    FakeRedis.reset();
    const config = loadConfig({ REDIS_URL: "redis://localhost:6379", LOG_LEVEL: "silent" });
    const transport = createFakeTransport();
    const app = createApp(config, { transport: transport.factory, market: new FakeMarketData() });
    expect(app.pubsub).toBeInstanceOf(RedisPubSub);
    // pub, sub and one coordination client (lock, registry, snapshot store; ADR-062)
    expect(FakeRedis.clients.map((r) => r.url)).toEqual(["redis://localhost:6379", "redis://localhost:6379", "redis://localhost:6379"]);
    FakeRedis.clients[0]?.emitError(new Error("redis down"));
    await app.start();
    expect(app.role.role()).toBe("leader");
    await app.stop();
    expect(FakeRedis.clients.every((c) => c.quitCalls === 1)).toBe(true);
  });
});

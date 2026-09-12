import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ErrorContext, ErrorSink } from "./error-sink.js";
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

  it("HC-SH-122 opens one session per enabled venue from GATEWAY_VENUES, the default venue first (ADR-067)", () => {
    const config = loadConfig({ GATEWAY_VENUES: "deribit", LOG_LEVEL: "silent" });
    const app = createApp(config, { market: new FakeMarketData() });
    expect(Object.keys(app.feed.status().venues)).toEqual(["delta_india", "deribit"]);
    expect(app.feed.status().venues["deribit"]?.market.socket).toBe("idle"); // built, never started: no network in tests
    expect(app.feed.supports("chain:deribit:BTC:2026-09-12")).toBe(true);
    const solo = createApp(loadConfig({ LOG_LEVEL: "silent" }), { market: new FakeMarketData() });
    expect(Object.keys(solo.feed.status().venues)).toEqual(["delta_india"]);
  });
});

describe("HC-SH-133 the gateway error sink (ADR-081)", () => {
  it("every error-level log of the default logger reaches the injected sink with its fields; stop flushes it; no DSN means an off sink", async () => {
    const captured: { error: unknown; ctx: ErrorContext }[] = [];
    let flushed = 0;
    const errors: ErrorSink = {
      enabled: true,
      capture: (error, ctx = {}) => {
        captured.push({ error, ctx });
        return "evt";
      },
      flush: () => {
        flushed += 1;
        return Promise.resolve();
      },
      stats: () => ({ sent: captured.length, dropped: 0, failed: 0 }),
    };
    const config = loadConfig({ GATEWAY_PORT: "0", LOG_LEVEL: "error" });
    const transport = createFakeTransport(4322);
    const app = createApp(config, { transport: transport.factory, market: new FakeMarketData(), errors });
    expect(app.errors).toBe(errors);
    const boom = new Error("upstream closed");
    app.log.error("feed failed", { error: boom, venue: "delta_india" });
    expect(captured).toEqual([{ error: boom, ctx: { level: "error", logger: "log", tags: { msg: "feed failed", venue: "delta_india" }, handled: false } }]);
    await app.start();
    const metrics = app.server.handlers.http({ method: "GET", url: "/metrics", headers: {} });
    expect(metrics.body).toContain('hapiecoin_gateway_error_sink_events_total{outcome="sent"} 1\n');
    expect(metrics.body).toContain('hapiecoin_gateway_error_sink_events_total{outcome="failed"} 0\n');
    await app.stop();
    expect(flushed).toBe(1);

    const quiet = createApp(loadConfig({ GATEWAY_PORT: "0", LOG_LEVEL: "silent" }), { transport: createFakeTransport(4323).factory, market: new FakeMarketData() });
    expect(quiet.errors.enabled).toBe(false);
    expect(quiet.errors.capture(new Error("x"))).toBeNull();

    // a DSN with a tracker that is down: the failed send is counted and reported through the logger, never thrown
    const down = createApp(loadConfig({ GATEWAY_PORT: "0", LOG_LEVEL: "silent", ERROR_SINK_DSN: "https://key@track.local/1", RELEASE: "g1" }), {
      transport: createFakeTransport(4324).factory,
      market: new FakeMarketData(),
      fetch: () => Promise.reject(new Error("tracker down")),
    });
    expect(down.errors.enabled).toBe(true);
    expect(down.errors.capture(new Error("feed broke"))).toMatch(/^[0-9a-f]{32}$/);
    await down.errors.flush();
    expect(down.errors.stats()).toEqual({ sent: 0, dropped: 0, failed: 1 });
  });
});

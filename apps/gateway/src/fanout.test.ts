/**
 * Two gateways on one Redis (ADR-062): the first takes the feed lease, the second follows; a client on the follower
 * gets its first snapshot from the store the leader writes and live frames through the fan-out; when the leader
 * stops, the follower takes the lease, opens the socket and watches what its clients hold.
 */
import type { Topic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FakeMarketData } from "./test-support/fake-market.js";
import { FakeRedis } from "./test-support/fake-redis.js";
import { createFakeTransport } from "./test-support/fake-transport.js";

vi.mock("ioredis", async () => ({ default: (await import("./test-support/fake-redis.js")).FakeRedis }));

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const CALL = "C-BTC-80000-250926";

function gateway(instance: string, port: number) {
  const config = loadConfig({ REDIS_URL: "redis://shared", LOG_LEVEL: "silent", GATEWAY_PORT: "0", LEADER_TTL_MS: "3000", HOLD_SYNC_MS: "250", COALESCE_MS: "50" });
  const transport = createFakeTransport(port);
  const market = new FakeMarketData();
  const app = createApp(config, { transport: transport.factory, market, instanceId: instance });
  return { app, transport, market };
}

beforeEach(() => {
  FakeRedis.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  FakeRedis.reset();
});

describe("[GATEWAY] two gateways, one feed (ADR-062)", () => {
  it("leader and follower serve clients together; the follower takes over when the leader stops", async () => {
    const one = gateway("one", 4001);
    const two = gateway("two", 4002);
    await one.app.start();
    expect(one.app.role.role()).toBe("leader");
    expect(one.market.socket).toBe("open");
    await two.app.start();
    expect(two.app.role.role()).toBe("follower");
    expect(two.market.socket).toBe("idle");
    expect(JSON.parse(two.app.server.handlers.http({ method: "GET", url: "/healthz", headers: {} }).body)).toMatchObject({ ok: true, role: "follower" });
    expect(two.app.server.handlers.http({ method: "GET", url: "/metrics", headers: {} }).body).toContain("hapiecoin_gateway_leader 0\n");
    expect(one.app.server.handlers.http({ method: "GET", url: "/metrics", headers: {} }).body).toContain("hapiecoin_gateway_leader 1\n");

    // a client on the follower subscribes: the hold reaches the registry, the leader watches upstream and writes the
    // first snapshot, the follower serves it
    const conn = two.transport.connect() as NonNullable<ReturnType<typeof two.transport.connect>>;
    two.transport.send(conn, { op: "sub", topics: [TOPIC] });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(one.market.watchCalls).toEqual(["BTC:2026-09-25"]);
    const frames = conn.frames();
    expect(frames[0]).toMatchObject({ t: "snap", topic: TOPIC });
    expect((frames[0] as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    // a tick at the leader reaches the follower's client through Redis with the next seq
    one.market.tick(one.market.later(CALL, { mark: "1300", ask: "1330" }));
    await vi.advanceTimersByTimeAsync(200);
    const q = conn.frames().find((f) => f.t === "q");
    expect(q).toMatchObject({ t: "q", topic: TOPIC, seq: (frames[0] as { seq: number }).seq + 1 });
    expect(two.market.watchCalls).toEqual([]);

    // the leader stops: the lease is released, the follower takes it within its retry interval and watches its client's topic
    await one.app.stop();
    expect(one.market.socket).toBe("closed");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(two.app.role.role()).toBe("leader");
    expect(two.market.socket).toBe("open");
    expect(two.market.watchCalls).toEqual(["BTC:2026-09-25"]);
    expect(conn.isOpen).toBe(true);
    // the new leader announces the chain: the client gets a fresh snapshot (seq restarts) and the next deltas follow it
    const after = conn.frames().slice(conn.frames().findIndex((f, i) => i > 0 && f.t === "snap"));
    expect(after[0]).toMatchObject({ t: "snap", topic: TOPIC, seq: 0 });
    two.market.tick(two.market.later(CALL, { mark: "1400" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(conn.frames().at(-1)).toMatchObject({ t: "q", topic: TOPIC, seq: 1 });
    await two.app.stop();
    expect(two.market.socket).toBe("closed");
  });

  it("GATEWAY_ROLE=follower never joins the election and stays a follower alone", async () => {
    const config = loadConfig({ REDIS_URL: "redis://shared", LOG_LEVEL: "silent", GATEWAY_PORT: "0", GATEWAY_ROLE: "follower" });
    const transport = createFakeTransport(4003);
    const market = new FakeMarketData();
    const app = createApp(config, { transport: transport.factory, market, instanceId: "solo" });
    await app.start();
    expect(app.leader()).toBeNull();
    expect(app.role.role()).toBe("follower");
    expect(market.socket).toBe("idle");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(app.role.role()).toBe("follower");
    await app.stop();
  });
});

describe("[GATEWAY] election edges", () => {
  it("a Redis outage during the lease drops the leader to follower and logs; the role comes back when Redis does; a failing quit at stop is swallowed", async () => {
    const lines: string[] = [];
    const config = loadConfig({ REDIS_URL: "redis://shared", LOG_LEVEL: "silent", GATEWAY_PORT: "0", LEADER_TTL_MS: "3000", HOLD_SYNC_MS: "250" });
    const transport = createFakeTransport(4010);
    const market = new FakeMarketData();
    const { InProcessPubSub } = await import("./pubsub/in-process.js");
    const { createLogger } = await import("./log.js");
    const app = createApp(config, { transport: transport.factory, market, instanceId: "edge", pubsub: new InProcessPubSub(), log: createLogger("debug", (l) => lines.push(l)) });
    await app.start();
    expect(app.role.role()).toBe("leader");
    FakeRedis.failCommands = true;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(app.role.role()).toBe("follower");
    expect(lines.some((l) => l.includes("feed lease error"))).toBe(true);
    FakeRedis.failCommands = false;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(app.role.role()).toBe("leader");
    FakeRedis.failQuit = true;
    await app.stop();
    expect(market.socket).toBe("closed");
  });
});

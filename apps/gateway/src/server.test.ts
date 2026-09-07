import { ChainRow, ServerMessage } from "@hapiecoin/schema";
import type { Topic } from "@hapiecoin/schema";
import type { Instrument } from "@hapiecoin/venues";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameEncoder } from "./encoder.js";
import { MarketFeed } from "./feed/feed.js";
import { createLogger } from "./log.js";
import { InProcessPubSub } from "./pubsub/in-process.js";
import { GatewayServer, MAX_STRIKES } from "./server.js";
import type { FeedLike, ServerConfig } from "./server.js";
import { FakeMarketData } from "./test-support/fake-market.js";
import { createFakeTransport } from "./test-support/fake-transport.js";
import { NOW } from "./test-support/fixtures.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const CALL = "C-BTC-80000-250926";
const CONFIG: ServerConfig = {
  NODE_ENV: "development",
  WEB_URL: "http://localhost:3000",
  MAX_TOPICS_PER_CONN: 3,
  MAX_BUFFERED_BYTES: 1_024,
  COALESCE_MS: 250,
};

let now = NOW;

async function make(config: Partial<ServerConfig> = {}, encoder?: FrameEncoder) {
  const market = new FakeMarketData();
  const pubsub = new InProcessPubSub();
  const feed = new MarketFeed({ market, pubsub, coalesceMs: 250, graceMs: 1_000, now: () => now });
  const transport = createFakeTransport();
  const lines: string[] = [];
  const server = new GatewayServer({
    config: { ...CONFIG, ...config },
    feed,
    pubsub,
    transport: transport.factory,
    now: () => now,
    log: createLogger(
      "debug",
      (line) => lines.push(line),
      () => now,
    ),
    ...(encoder ? { encoder } : {}),
  });
  await feed.start();
  await server.listen(0, "127.0.0.1");
  return { market, pubsub, feed, transport, server, lines };
}

function http(server: GatewayServer, url: string, method = "GET") {
  return server.handlers.http({ method, url, headers: {} });
}

beforeEach(() => {
  now = NOW;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[GATEWAY] HTTP endpoints", () => {
  it("[GATEWAY] /healthz is 503 while the feed loads and 200 with feed status once ready", async () => {
    const market = new FakeMarketData();
    const pubsub = new InProcessPubSub();
    const feed = new MarketFeed({ market, pubsub, coalesceMs: 250, now: () => now });
    const transport = createFakeTransport();
    const server = new GatewayServer({
      config: CONFIG,
      feed,
      pubsub,
      transport: transport.factory,
      now: () => now,
    });
    const starting = http(server, "/healthz");
    expect(starting.status).toBe(503);
    expect(JSON.parse(starting.body)).toMatchObject({
      ok: false,
      status: "starting",
      connections: 0,
      encoder: "json",
    });
    expect(http(server, "/metrics").body).toContain("hapiecoin_gateway_feed_ready 0\n");

    await feed.start();
    now += 1_500;
    const ready = http(server, "/healthz?probe=1");
    expect(ready.status).toBe(200);
    expect(ready.contentType).toBe("application/json");
    const body = JSON.parse(ready.body) as {
      ok: boolean;
      uptimeMs: number;
      feed: { expiries: { BTC: string[] }; spot: { BTC: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.uptimeMs).toBe(1_500);
    expect(body.feed.expiries.BTC[0]).toBe("2026-09-05");
    expect(body.feed.spot.BTC).toMatch(/^\d/);
    feed.stop();
  });

  it("[GATEWAY] /metrics reports connections, topics and a per-scrape message rate; other paths 404, non-GET 405", async () => {
    const { server, transport } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC, "spot:BTC"] });
    transport.send(conn, { op: "ping" });
    now += 2_000;
    const metrics = http(server, "/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.contentType).toMatch(/^text\/plain/);
    expect(metrics.body).toContain("hapiecoin_gateway_connections 1\n");
    expect(metrics.body).toContain("hapiecoin_gateway_topics 2\n");
    expect(metrics.body).toContain("hapiecoin_gateway_subscriptions 2\n");
    expect(metrics.body).toContain("hapiecoin_gateway_messages_sent_total 3\n");
    expect(metrics.body).toContain("hapiecoin_gateway_messages_per_second 1.500\n");
    expect(metrics.body).toContain("hapiecoin_gateway_feed_ready 1\n");
    expect(metrics.body).toContain("hapiecoin_gateway_feed_instruments 972\n");
    // a second scrape measures only what happened since the first
    now += 1_000;
    expect(http(server, "/metrics").body).toContain("hapiecoin_gateway_messages_per_second 0.000\n");
    expect(http(server, "/nope").status).toBe(404);
    expect(http(server, "/healthz", "POST").status).toBe(405);
    await server.close();
  });

  it("[GATEWAY] /healthz answers CORS for the allowed web origin only, and OPTIONS preflight with 204", async () => {
    const { server } = await make();
    const allowed = server.handlers.http({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3000" } });
    expect(allowed.headers).toMatchObject({ "access-control-allow-origin": "http://localhost:3000", vary: "origin" });
    const foreign = server.handlers.http({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
    expect(foreign.headers?.["access-control-allow-origin"]).toBeUndefined();
    const noOrigin = server.handlers.http({ method: "GET", url: "/metrics", headers: {} });
    expect(noOrigin.headers?.["access-control-allow-origin"]).toBeUndefined();
    const preflight = server.handlers.http({
      method: "OPTIONS",
      url: "/healthz",
      headers: { origin: "http://localhost:3000" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:3000",
      "access-control-allow-methods": "GET",
    });
    expect(server.handlers.http({ method: "POST", url: "/healthz", headers: { origin: "http://localhost:3000" } }).headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:3000",
    });
    expect(server.handlers.http({ method: "GET", url: "/nope", headers: { origin: "http://localhost:3000" } }).headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:3000",
    });
    await server.close();
  });
});

describe("[GATEWAY] origin check on upgrade", () => {
  it("[GATEWAY] allows no Origin, WEB_URL and localhost in development; refuses others and garbage", async () => {
    const { transport, lines } = await make();
    expect(transport.connect()).not.toBeNull();
    expect(transport.connect({ origin: "http://localhost:3000" })).not.toBeNull();
    expect(transport.connect({ origin: "http://localhost:5173" })).not.toBeNull();
    expect(transport.connect({ origin: "http://127.0.0.1:3000" })).not.toBeNull();
    expect(transport.connect({ origin: "https://evil.example" })).toBeNull();
    expect(transport.connect({ origin: "not a url" })).toBeNull();
    expect(lines.filter((l) => l.includes("upgrade refused"))).toHaveLength(2);
  });

  it("[GATEWAY] in production only WEB_URL is allowed", async () => {
    const { transport } = await make({ NODE_ENV: "production", WEB_URL: "https://hapiecoin.com" });
    expect(transport.connect({ origin: "https://hapiecoin.com" })).not.toBeNull();
    expect(transport.connect({ origin: "https://hapiecoin.com/" })).not.toBeNull();
    expect(transport.connect({ origin: "http://localhost:3000" })).toBeNull();
    expect(transport.connect({ origin: "https://app.hapiecoin.com" })).toBeNull();
  });
});

describe("[GATEWAY] subscribe: snapshot then coalesced deltas", () => {
  it("[GAPS-1] sub chain sends a snap whose strikes equal the instrument list, then q frames with seq", async () => {
    const { market, transport, feed, server } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    expect(conn.frames()).toHaveLength(1);
    const snap = conn.last() as Extract<ServerMessage, { t: "snap" }>;
    expect(ServerMessage.parse(snap)).toEqual(snap);
    expect(snap).toMatchObject({ t: "snap", topic: TOPIC, seq: 0 });
    expect(snap.rows).toHaveLength(52);
    for (const row of snap.rows) expect(ChainRow.parse(row)).toEqual(row);
    const expected = [
      ...new Set(
        market.instrumentList
          .filter((i: Instrument) => i.underlying === "BTC" && i.expiryCode === "250926")
          .map((i) => i.strike),
      ),
    ].sort((a, b) => Number(a) - Number(b));
    expect(snap.rows.map((r) => r.strike)).toEqual(expected);
    expect(feed.holders(TOPIC)).toBe(1);

    // duplicate sub is idempotent
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    expect(conn.frames()).toHaveLength(1);
    expect(feed.holders(TOPIC)).toBe(1);

    market.tick(market.later(CALL, { mark: "1300" }));
    market.tick(market.later(CALL, { mark: "1301", bid: "1290" }, 2_000));
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toHaveLength(2);
    const q = conn.last() as Extract<ServerMessage, { t: "q" }>;
    expect(ServerMessage.parse(q)).toEqual(q);
    expect(q).toMatchObject({ t: "q", topic: TOPIC, seq: 1 });
    expect(q.d).toEqual([
      { i: `delta_india:${CALL}`, ts: expect.any(Number) as number, mark: "1301", bid: "1290" },
    ]);

    market.tick(market.later(CALL, { mark: "1302" }, 3_000));
    vi.advanceTimersByTime(250);
    expect((conn.last() as { seq: number }).seq).toBe(2);

    // unsub stops delivery and releases the feed (grace, then upstream unsubscribe)
    transport.send(conn, { op: "unsub", topics: [TOPIC, "spot:ETH"] });
    market.tick(market.later(CALL, { mark: "1303" }, 4_000));
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toHaveLength(3);
    expect(feed.holders(TOPIC)).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
    await server.close();
  });

  it("[GATEWAY] sub spot sends the current spot and later spot ticks; ping answers pong", async () => {
    const { market, transport } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: ["spot:BTC", "spot:ETH"] });
    expect(conn.frames()).toEqual([{ t: "spot", s: "BTC", p: market.quote(CALL)?.spot }]); // ETH spot unknown: nothing yet
    market.tick(market.later(CALL, { spot: "80000" }));
    vi.advanceTimersByTime(250);
    expect(conn.last()).toEqual({ t: "spot", s: "BTC", p: "80000" });
    transport.send(conn, { op: "ping" });
    expect(conn.last()).toEqual({ t: "pong" });
  });

  it("[GATEWAY] unsupported, unknown and over-limit topics answer with err frames", async () => {
    const { transport, feed } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: ["fut:delta_india:BTCUSD"] });
    expect(conn.last()).toMatchObject({ t: "err", code: "unsupported_topic" });
    transport.send(conn, { op: "sub", topics: ["chain:delta_india:BTC:2030-01-01"] });
    expect(conn.last()).toMatchObject({ t: "err", code: "unknown_topic" });
    expect(feed.holders("chain:delta_india:BTC:2030-01-01")).toBe(0);

    const dates = feed.status().expiries.BTC.slice(0, 4);
    transport.send(conn, { op: "sub", topics: dates.map((d) => `chain:delta_india:BTC:${d}`) });
    const frames = conn.frames();
    expect(frames.filter((f) => f.t === "snap")).toHaveLength(3);
    expect(frames.at(-1)).toMatchObject({ t: "err", code: "topic_limit" });
    expect(String((frames.at(-1) as { message: string }).message)).toContain("at most 3 topics");
    for (const f of frames) expect(ServerMessage.parse(f)).toEqual(f);
    expect(conn.isOpen).toBe(true); // err frames for protocol limits are not strikes
  });

  it("[GATEWAY] invalid frames earn err replies; the third strike closes with 1008", async () => {
    const { transport, feed, server } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    transport.send(conn, "{not json");
    expect(conn.last()).toMatchObject({ t: "err", code: "invalid_json" });
    transport.send(conn, 42);
    expect(conn.last()).toMatchObject({ t: "err", code: "invalid_message" });
    expect(String((conn.last() as { message: string }).message)).toMatch(/^<root>/);
    expect(conn.isOpen).toBe(true);
    transport.send(conn, { op: "sub", topics: ["spot:SOL"] });
    expect(conn.last()).toMatchObject({ t: "err", code: "invalid_message" });
    expect(String((conn.last() as { message: string }).message)).toMatch(/^topics\.0/);
    expect(conn.closed).toEqual({ code: 1008, reason: "too many invalid messages" });
    expect(MAX_STRIKES).toBe(3);
    expect(server.connectionCount()).toBe(0);
    expect(feed.holders(TOPIC)).toBe(0);
    // frames from a connection the server no longer tracks are ignored, as is a second close
    transport.send(conn, { op: "ping" });
    server.handlers.close(conn, 1000, "");
    expect(conn.frames().filter((f) => f.t === "pong")).toHaveLength(0);
  });
});

describe("[GATEWAY] backpressure", () => {
  it("[GATEWAY] drops coalesced frames while the buffer is over the limit and resyncs with a snap when it drains", async () => {
    const { market, transport, server, pubsub } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC, "spot:BTC"] });
    conn.clear();

    conn.buffered = 2_048;
    market.tick(market.later(CALL, { mark: "1300", spot: "80000" }));
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toEqual([]);
    expect(http(server, "/metrics").body).toContain("hapiecoin_gateway_messages_dropped_total 2\n");

    // still stalled: the sweep does nothing while the buffer is high
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toEqual([]);

    // drained: the next frame for the topic is replaced by a fresh snapshot (and spot by the current spot)
    conn.buffered = 0;
    pubsub.publish(TOPIC, { t: "q", topic: TOPIC, seq: 99, d: [{ i: `delta_india:${CALL}`, mark: "0" }] });
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "0" });
    expect(conn.frames().map((f) => f.t)).toEqual(["snap", "spot"]);
    const snap = conn.frames()[0] as Extract<ServerMessage, { t: "snap" }>;
    expect(snap.seq).toBe(1);
    expect(snap.rows.find((r) => r.strike === "80000")?.call?.mark).toBe("1300");
    expect(conn.frames()[1]).toEqual({ t: "spot", s: "BTC", p: "80000" });

    // back to normal deltas afterwards
    conn.clear();
    market.tick(market.later(CALL, { mark: "1302" }, 3_000));
    vi.advanceTimersByTime(250);
    expect(conn.frames().find((f) => f.t === "q")).toMatchObject({ t: "q", seq: 2, d: [{ mark: "1302" }] });
  });

  it("[GATEWAY] the periodic sweep resyncs stalled topics that receive no further frames", async () => {
    const { market, transport } = await make();
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC, "spot:BTC"] });
    conn.clear();
    conn.buffered = 5_000;
    market.tick(market.later(CALL, { mark: "1300", spot: "80000" }));
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toEqual([]);
    conn.buffered = 0;
    vi.advanceTimersByTime(250); // sweep tick, nothing else pending
    expect(
      conn
        .frames()
        .map((f) => f.t)
        .sort(),
    ).toEqual(["snap", "spot"]);
    // a connection whose socket died silently gets nothing
    conn.clear();
    conn.buffered = 5_000;
    market.tick(market.later(CALL, { mark: "1301" }, 2_000));
    vi.advanceTimersByTime(250);
    conn.isOpen = false;
    conn.buffered = 0;
    vi.advanceTimersByTime(250);
    market.tick(market.later(CALL, { mark: "1302" }, 3_000));
    vi.advanceTimersByTime(250);
    expect(conn.frames()).toEqual([]);
  });

  it("[GATEWAY] a resync with nothing to send (expiry gone, spot unknown) sends nothing", () => {
    let snapshots = 0;
    const feed: FeedLike = {
      status: () => ({
        ready: true,
        market: { instruments: 0, quotes: 0, socket: "open", subscribed: 0 },
        expiries: { BTC: [], ETH: [], XAUT: [] },
        spot: { BTC: null, ETH: null, XAUT: null },
        topics: 0,
        pending: 0,
        loadedAt: NOW,
        lastError: null,
      }),
      supports: () => true,
      seq: () => 0,
      snapshot: () => (snapshots++ === 0 ? { seq: 0, rows: [] } : null),
      spot: () => null,
      acquire: () => undefined,
      release: () => undefined,
    };
    const pubsub = new InProcessPubSub();
    const transport = createFakeTransport();
    const server = new GatewayServer({
      config: CONFIG,
      feed,
      pubsub,
      transport: transport.factory,
      now: () => now,
    });
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC, "spot:BTC"] });
    expect(conn.frames()).toEqual([{ t: "snap", topic: TOPIC, seq: 0, rows: [] }]);
    expect(server.connectionCount()).toBe(1);
    conn.clear();
    conn.buffered = 5_000;
    pubsub.publish(TOPIC, { t: "q", topic: TOPIC, seq: 1, d: [{ i: "delta_india:X", mark: "1" }] });
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "1" });
    conn.buffered = 0;
    pubsub.publish(TOPIC, { t: "q", topic: TOPIC, seq: 2, d: [{ i: "delta_india:X", mark: "2" }] });
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "2" });
    expect(conn.frames()).toEqual([]);
    // the following frames flow again
    pubsub.publish(TOPIC, { t: "q", topic: TOPIC, seq: 3, d: [{ i: "delta_india:X", mark: "3" }] });
    expect(conn.last()).toMatchObject({ t: "q", seq: 3 });
  });
});

describe("[GATEWAY] shutdown and encoder", () => {
  it("[GATEWAY] close releases topics, closes every connection with 1001 and stops the transport", async () => {
    const { transport, feed, server, market } = await make();
    const a = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    const b = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(a, { op: "sub", topics: [TOPIC] });
    transport.send(b, { op: "sub", topics: [TOPIC, "spot:BTC"] });
    expect(feed.holders(TOPIC)).toBe(2);
    a.disconnect(1000, "bye");
    expect(feed.holders(TOPIC)).toBe(1);
    expect(server.connectionCount()).toBe(1);

    await server.close();
    expect(b.closed).toEqual({ code: 1001, reason: "server shutdown" });
    expect(server.connectionCount()).toBe(0);
    expect(feed.holders(TOPIC)).toBe(0);
    expect(transport.closed).toBe(true);
    await server.close(); // idempotent
    vi.advanceTimersByTime(1_000);
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
  });

  it("[GATEWAY] the frame encoder is pluggable (binary frames reach the connection untouched)", async () => {
    const encoder: FrameEncoder = {
      name: "test-binary",
      binary: true,
      encode: (m) => new TextEncoder().encode(JSON.stringify(m)),
    };
    const { transport, server } = await make({}, encoder);
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "ping" });
    expect(conn.sent[0]).toBeInstanceOf(Uint8Array);
    expect(conn.last()).toEqual({ t: "pong" });
    expect(JSON.parse(http(server, "/healthz").body)).toMatchObject({ encoder: "test-binary" });
  });
});

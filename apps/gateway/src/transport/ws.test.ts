/** Integration: the real `ws` transport with real sockets on 127.0.0.1 (port 0), a real feed on fixtures. */
import { ServerMessage } from "@hapiecoin/schema";
import type { Topic } from "@hapiecoin/schema";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MarketFeed } from "../feed/feed.js";
import { InProcessPubSub } from "../pubsub/in-process.js";
import { GatewayServer } from "../server.js";
import { FakeMarketData } from "../test-support/fake-market.js";
import type { Connection } from "./types.js";
import { createWsServer, rawToString, toHttpRequest, toUpgradeRequest } from "./ws.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const CALL = "C-BTC-80000-250926";

const cleanups: (() => Promise<void>)[] = [];

async function boot(maxPayloadBytes?: number) {
  const market = new FakeMarketData();
  const pubsub = new InProcessPubSub();
  const feed = new MarketFeed({ market, pubsub, coalesceMs: 30, graceMs: 0 });
  const server = new GatewayServer({
    config: {
      NODE_ENV: "development",
      WEB_URL: "http://localhost:3000",
      MAX_TOPICS_PER_CONN: 50,
      MAX_CONNECTIONS_PER_IP: 20,
      MAX_BUFFERED_BYTES: 1_048_576,
      COALESCE_MS: 30,
    },
    feed,
    pubsub,
    transport: (handlers) =>
      createWsServer(handlers, maxPayloadBytes === undefined ? {} : { maxPayloadBytes }),
  });
  await feed.start();
  const port = await server.listen(0, "127.0.0.1");
  cleanups.push(async () => {
    await server.close();
    feed.stop();
  });
  return { market, feed, server, port, url: `ws://127.0.0.1:${port}` };
}

function connect(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  const frames: ServerMessage[] = [];
  const waiters: ((frame: ServerMessage) => void)[] = [];
  ws.on("message", (data) => {
    const frame = JSON.parse(rawToString(data)) as ServerMessage;
    frames.push(frame);
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
  });
  const next = () =>
    new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no frame within 3 s")), 3_000);
      waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  return { ws, frames, next, opened, closed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("[GATEWAY] ws transport (real sockets)", () => {
  it("[GATEWAY] serves /healthz and /metrics over HTTP and refuses non-GET", async () => {
    const { port } = await boot();
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toBe("application/json");
    expect(health.headers.get("cache-control")).toBe("no-store");
    const body = (await health.json()) as { ok: boolean; feed: { expiries: { BTC: string[] } } };
    expect(body.ok).toBe(true);
    expect(body.feed.expiries.BTC).toContain("2026-09-25");
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(await metrics.text()).toContain("hapiecoin_gateway_connections 0\n");
    const post = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "POST" });
    expect(post.status).toBe(405);
    // extra response headers (CORS for the web origin) are written through the transport
    const cors = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { origin: "http://localhost:3000" } });
    expect(cors.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(cors.headers.get("vary")).toBe("origin");
    const foreign = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { origin: "https://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("[GATEWAY] subscribe -> snap -> q deltas, ping/pong, binary frames are invalid, close frees the connection", async () => {
    const { market, server, url, port } = await boot();
    const client = connect(url);
    await client.opened;
    client.ws.send(JSON.stringify({ op: "sub", topics: [TOPIC] }));
    const snap = await client.next();
    expect(ServerMessage.parse(snap)).toEqual(snap);
    expect(snap).toMatchObject({ t: "snap", topic: TOPIC, seq: 0 });
    expect((snap as { rows: unknown[] }).rows).toHaveLength(52);
    expect(server.connectionCount()).toBe(1);

    market.tick(market.later(CALL, { mark: "1300" }));
    const q = await client.next();
    expect(q).toMatchObject({
      t: "q",
      topic: TOPIC,
      seq: 1,
      d: [{ i: `delta_india:${CALL}`, mark: "1300" }],
    });

    client.ws.send(JSON.stringify({ op: "ping" }));
    expect(await client.next()).toEqual({ t: "pong" });

    client.ws.send(Buffer.from([0x00, 0x01]));
    expect(await client.next()).toMatchObject({ t: "err", code: "invalid_json" });

    client.ws.close(1000, "done");
    const closed = await client.closed;
    expect(closed.code).toBe(1000);
    await settle();
    expect(server.connectionCount()).toBe(0);
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(await metrics.text()).toContain("hapiecoin_gateway_connections 0\n");
  });

  it("[GATEWAY] a browser origin outside WEB_URL/localhost is refused with 403", async () => {
    const { url } = await boot();
    const refused = connect(url, { origin: "https://evil.example" });
    await expect(refused.opened).rejects.toThrow(/403/);
    const allowed = connect(url, { origin: "http://localhost:3000" });
    await allowed.opened;
    allowed.ws.close();
    await allowed.closed;
  });

  it("[GATEWAY] server close sends 1001 to open clients; a frame above maxPayload closes the socket", async () => {
    const { url, server } = await boot(64);
    const client = connect(url);
    await client.opened;
    const big = connect(url);
    await big.opened;
    big.ws.send(JSON.stringify({ op: "sub", topics: Array.from({ length: 20 }, () => "spot:BTC") }));
    const bigClosed = await big.closed;
    expect(bigClosed.code).toBe(1009);
    await settle();
    expect(server.connectionCount()).toBe(1);

    await server.close();
    const closed = await client.closed;
    expect(closed).toEqual({ code: 1001, reason: "server shutdown" });
  });

  it("[GATEWAY] listen rejects when the port is taken", async () => {
    const { port } = await boot();
    const other = createWsServer({
      http: () => ({ status: 200, contentType: "text/plain", body: "" }),
      upgrade: () => true,
      open: () => undefined,
      message: () => undefined,
      close: () => undefined,
    });
    await expect(other.listen(port, "127.0.0.1")).rejects.toThrow(/EADDRINUSE/);
    expect(other.connectionCount()).toBe(0);
    await other.close();
  });

  it("[GATEWAY] a connection whose socket already closed ignores sends and reports closed", async () => {
    const market = new FakeMarketData();
    const pubsub = new InProcessPubSub();
    const feed = new MarketFeed({ market, pubsub, coalesceMs: 30, graceMs: 0 });
    let captured: Connection | null = null;
    const server = new GatewayServer({
      config: {
        NODE_ENV: "development",
        WEB_URL: "http://localhost:3000",
        MAX_TOPICS_PER_CONN: 50,
        MAX_CONNECTIONS_PER_IP: 20,
        MAX_BUFFERED_BYTES: 1_048_576,
        COALESCE_MS: 30,
      },
      feed,
      pubsub,
      transport: (handlers) =>
        createWsServer({
          ...handlers,
          open: (conn) => {
            captured = conn;
            handlers.open(conn);
          },
        }),
    });
    await feed.start();
    const port = await server.listen(0, "127.0.0.1");
    cleanups.push(async () => {
      await server.close();
      feed.stop();
    });
    const client = connect(`ws://127.0.0.1:${port}`);
    await client.opened;
    await settle();
    const conn = captured as Connection | null;
    expect(conn).not.toBeNull();
    expect(conn?.isOpen).toBe(true);
    expect(conn?.bufferedAmount()).toBe(0);
    expect(conn?.remoteAddress).toBe("127.0.0.1");
    client.ws.close();
    await client.closed;
    await settle();
    expect(conn?.isOpen).toBe(false);
    expect(() => conn?.send("late frame")).not.toThrow();
  });

  it("[GATEWAY] request adapters fill Node's optional fields and flatten array headers", () => {
    expect(toHttpRequest({ headers: { "set-cookie": ["a=1", "b=2"], host: "x" }, socket: {} })).toEqual({
      method: "GET",
      url: "/",
      headers: { "set-cookie": "a=1, b=2", host: "x" },
    });
    expect(toHttpRequest({ method: "POST", url: "/metrics", headers: {}, socket: {} })).toEqual({
      method: "POST",
      url: "/metrics",
      headers: {},
    });
    expect(toUpgradeRequest({ headers: {}, socket: {} })).toEqual({
      url: "/",
      headers: {},
      remoteAddress: "",
    });
    expect(
      toUpgradeRequest({
        url: "/ws",
        headers: { origin: "http://localhost:3000" },
        socket: { remoteAddress: "::1" },
      }),
    ).toEqual({
      url: "/ws",
      headers: { origin: "http://localhost:3000" },
      remoteAddress: "::1",
    });
  });

  it("[GATEWAY] rawToString handles Buffer, Buffer[] and ArrayBuffer", () => {
    expect(rawToString(Buffer.from("ab"))).toBe("ab");
    expect(rawToString([Buffer.from("a"), Buffer.from("b")])).toBe("ab");
    expect(rawToString(new TextEncoder().encode("ab").buffer)).toBe("ab");
  });
});

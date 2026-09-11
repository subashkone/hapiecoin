/** GatewayServer with a feed that answers asynchronously (a follower gateway, ADR-062): queued first frames, races, failures. */
import type { ServerMessage, Topic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./log.js";
import { InProcessPubSub } from "./pubsub/in-process.js";
import { type FeedLike, GatewayServer } from "./server.js";
import { createFakeTransport } from "./test-support/fake-transport.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const CONFIG = { NODE_ENV: "test" as const, WEB_URL: "http://localhost:3000", MAX_TOPICS_PER_CONN: 3, MAX_BUFFERED_BYTES: 1_024, COALESCE_MS: 250, MAX_CONNECTIONS_PER_IP: 20 };
const ROWS = [{ strike: "80000" }];

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function make() {
  const pubsub = new InProcessPubSub();
  const snapshots: Deferred<{ seq: number; rows: typeof ROWS } | null>[] = [];
  const spots: Deferred<{ p: string; ts: number } | null>[] = [];
  const held: string[] = [];
  const feed: FeedLike = {
    status: () => ({ ready: true, role: "follower", market: { instruments: 1, quotes: 1, socket: "idle", subscribed: 0 } as never, expiries: { BTC: [], ETH: [], XAUT: [] }, spot: { BTC: null, ETH: null, XAUT: null }, venues: {}, topics: 0, pending: 0, loadedAt: 0, lastError: null }),
    supports: () => true,
    seq: () => 0,
    snapshot: () => {
      const d = deferred<{ seq: number; rows: typeof ROWS } | null>();
      snapshots.push(d);
      return d.promise;
    },
    spot: () => {
      const d = deferred<{ p: string; ts: number } | null>();
      spots.push(d);
      return d.promise;
    },
    acquire: (t) => void held.push(`+${t}`),
    release: (t) => void held.push(`-${t}`),
  };
  const transport = createFakeTransport();
  const lines: string[] = [];
  const server = new GatewayServer({ config: CONFIG, feed, pubsub, transport: transport.factory, log: createLogger("debug", (l) => lines.push(l)) });
  return { pubsub, snapshots, spots, held, transport, server, lines };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe("[GATEWAY] follower first frames (ADR-062)", () => {
  it("frames published while the snapshot is fetched are queued and replayed after it, minus those at or below its seq", async () => {
    const { pubsub, snapshots, transport, server } = make();
    await server.listen(0, "127.0.0.1");
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    const q = (seq: number): ServerMessage => ({ t: "q", topic: TOPIC, seq, d: [{ i: "delta_india:C-BTC-80000-250926", mark: String(seq) }] });
    pubsub.publish(TOPIC, q(4));
    pubsub.publish(TOPIC, q(5));
    pubsub.publish(TOPIC, q(6));
    expect(conn.frames()).toEqual([]);
    snapshots[0]!.resolve({ seq: 5, rows: ROWS });
    await flush();
    expect(conn.frames().map((f) => (f.t === "q" ? `q${f.seq}` : f.t))).toEqual(["snap", "q6"]);
    // live frames flow straight through afterwards
    pubsub.publish(TOPIC, q(7));
    expect(conn.frames().at(-1)).toMatchObject({ t: "q", seq: 7 });
    await server.close();
  });

  it("a topic unsubscribed or a connection closed while waiting sends nothing and releases the hold; a null answer is an unknown topic", async () => {
    const { snapshots, spots, held, transport, server } = make();
    await server.listen(0, "127.0.0.1");
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    transport.send(conn, { op: "unsub", topics: [TOPIC] });
    snapshots[0]!.resolve({ seq: 1, rows: ROWS });
    await flush();
    transport.send(conn, { op: "sub", topics: ["spot:BTC"] });
    await flush();
    transport.send(conn, { op: "unsub", topics: ["spot:BTC"] });
    spots[0]!.resolve({ p: "80000", ts: 1 });
    await flush();
    expect(conn.frames()).toEqual([]);
    expect(held).toEqual([`+${TOPIC}`, `-${TOPIC}`, "+spot:BTC", "-spot:BTC"]);
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    snapshots[1]!.resolve(null);
    await flush();
    expect(conn.last()).toMatchObject({ t: "err", code: "unknown_topic" });
    expect(held.at(-1)).toBe(`-${TOPIC}`);
    // the spot topic answers with the current spot once known
    transport.send(conn, { op: "sub", topics: ["spot:BTC"] });
    await flush();
    spots[1]!.resolve({ p: "80100", ts: 2 });
    await flush();
    expect(conn.last()).toEqual({ t: "spot", s: "BTC", p: "80100" });
    await server.close();
  });

  it("a rejected snapshot is logged, not fatal; a resync after backpressure also awaits the feed and logs a failure", async () => {
    const { pubsub, snapshots, spots, held, transport, server, lines } = make();
    await server.listen(0, "127.0.0.1");
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    snapshots[0]!.reject(new Error("store down"));
    await flush();
    expect(lines.some((l) => l.includes("first frame failed"))).toBe(true);
    expect(conn.isOpen).toBe(true);
    // the topic is closed cleanly: an err frame, the hold released, and the client may subscribe again
    expect(conn.last()).toMatchObject({ t: "err", code: "feed_unavailable" });
    expect(held.slice(-2)).toEqual([`+${TOPIC}`, `-${TOPIC}`]);
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    snapshots[1]!.resolve({ seq: 9, rows: ROWS });
    await flush();
    expect(conn.last()).toMatchObject({ t: "snap", seq: 9 });
    // a second topic subscribes fine; then backpressure: the drained frame triggers an async resync
    transport.send(conn, { op: "sub", topics: ["spot:BTC"] });
    await flush();
    spots[0]!.resolve({ p: "80000", ts: 1 });
    await flush();
    conn.buffered = 4_096;
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "1" });
    conn.buffered = 0;
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "2" });
    await flush();
    spots[1]!.reject(new Error("store down"));
    await flush();
    expect(lines.some((l) => l.includes("resync failed"))).toBe(true);
    // and a resync that resolves sends the fresh spot
    conn.buffered = 4_096;
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "3" });
    conn.buffered = 0;
    pubsub.publish("spot:BTC", { t: "spot", s: "BTC", p: "4" });
    await flush();
    spots[2]!.resolve({ p: "80200", ts: 3 });
    await flush();
    expect(conn.last()).toEqual({ t: "spot", s: "BTC", p: "80200" });
    await server.close();
  });
});

describe("[GATEWAY] follower subscribe: unexpected errors", () => {
  it("an error thrown before the first frame is fetched (acquire) is logged as subscribe failed and the connection stays open", async () => {
    const { transport, server, lines } = make();
    await server.listen(0, "127.0.0.1");
    const conn = transport.connect() as NonNullable<ReturnType<typeof transport.connect>>;
    const feed = (server as unknown as { feed: { acquire: (t: string) => void } }).feed;
    const original = feed.acquire;
    feed.acquire = () => {
      throw new Error("registry exploded");
    };
    transport.send(conn, { op: "sub", topics: [TOPIC] });
    await flush();
    expect(lines.some((l) => l.includes("subscribe failed") && l.includes("registry exploded"))).toBe(true);
    expect(conn.isOpen).toBe(true);
    feed.acquire = original;
    await server.close();
  });
});

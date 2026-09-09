import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { SocketLike } from "./liquidations.js";
import { createLogger } from "./log.js";
import { MemoryStore } from "./store.js";
import { healthyFetch } from "./test-support/fixtures.js";

const { FakeRedis, FakeWs } = vi.hoisted(() => {
  class FakeRedis {
    static instances: FakeRedis[] = [];
    readonly listeners: ((error: Error) => void)[] = [];
    readonly map = new Map<string, string>();
    constructor(readonly url: string) {
      FakeRedis.instances.push(this);
    }
    get(key: string): Promise<string | null> {
      return Promise.resolve(this.map.get(key) ?? null);
    }
    set(key: string, value: string): Promise<string> {
      this.map.set(key, value);
      return Promise.resolve("OK");
    }
    on(event: string, listener: (error: Error) => void): this {
      if (event === "error") this.listeners.push(listener);
      return this;
    }
    quit(): Promise<string> {
      return Promise.resolve("OK");
    }
  }
  class FakeWs {
    static instances: FakeWs[] = [];
    readonly handlers = new Map<string, ((...a: unknown[]) => void)[]>();
    constructor(readonly url: string) {
      FakeWs.instances.push(this);
    }
    on(event: string, listener: (...a: unknown[]) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const h of this.handlers.get(event) ?? []) h(...args);
    }
    close(): void {
      this.emit("close");
    }
  }
  return { FakeRedis, FakeWs };
});
vi.mock("ioredis", () => ({ default: FakeRedis }));
vi.mock("ws", () => ({ default: FakeWs }));

class FakeSocket implements SocketLike {
  handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  on(event: string, listener: (...a: unknown[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
  close(): void {
    this.emit("close");
  }
}

const env = { NODE_ENV: "test", INGEST_PORT: "0", ANALYTICS_SYMBOLS: "BTC", COINGECKO_API_KEY: "demo-key-123", BINANCE_FAPI_URL: "https://fapi", BYBIT_URL: "https://bybit", OKX_URL: "https://okx", COINGECKO_URL: "https://cg/api/v3", FNG_URL: "https://alt/fng/", LOG_LEVEL: "silent" };

describe("[INGEST] app", () => {
  it("boots on a free port, answers /healthz, runs every job into the store and stops", async () => {
    const lines: string[] = [];
    const store = new MemoryStore();
    const sockets: FakeSocket[] = [];
    const app = createApp(loadConfig(env), { fetch: healthyFetch().fetch, store, log: createLogger("info", (l) => lines.push(l)), createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, now: () => 1_788_900_000_000 });
    const port = await app.start();
    expect(port).toBeGreaterThan(0);
    expect(app.health().stream).toEqual({ binance: "off", bybit: "off" });
    expect(sockets).toHaveLength(2);
    sockets[0]!.emit("open");
    expect(app.health().stream).toEqual({ binance: "open", bybit: "off" });
    sockets[1]!.emit("open");
    expect(app.health().stream.bybit).toBe("open");
    const names = app.scheduler.statuses().map((j) => j.name);
    expect(names).toEqual(["funding:BTC", "open-interest:BTC", "long-short:BTC", "taker-volume:BTC", "liquidations:-", "markets:-", "fear-greed:-", "options:BTC", "options:ETH", "cycle:-", "rsi:-", "premium:-", "whales:-", "overview:-"]);
    for (const n of names) await app.scheduler.tick(n);
    expect(app.health().ok).toBe(true);
    expect((await store.get("markets:-"))?.source).toBe("CoinGecko");
    expect((await store.get("liquidations:-"))?.source).toBe("Binance · Bybit · OKX");
    const ov = await store.get("overview:-");
    expect(ov?.dataset === "overview" ? ov.data.symbols.map((s) => s.symbol) : []).toEqual(["BTC"]);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { store: string }).store).toBe("memory");
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
    sockets[0]!.emit("error", new Error("x"));
    expect(app.health().stream).toEqual({ binance: "error", bybit: "open" });
    await app.stop();
    expect(lines.some((l) => l.includes("ingest stopped"))).toBe(true);
  });
  it("skips the markets job without a CoinGecko key, can run without the stream, and reports 503 while a job has never succeeded", async () => {
    const lines: string[] = [];
    const app = createApp(loadConfig({ ...env, COINGECKO_API_KEY: "" }), { fetch: healthyFetch().on("/fng/", { status: 500, text: "down" }).fetch, log: createLogger("warn", (l) => lines.push(l)), stream: false });
    expect(lines.some((l) => l.includes("COINGECKO_API_KEY not set"))).toBe(true);
    expect(app.scheduler.statuses().map((j) => j.name)).not.toContain("markets:-");
    expect(app.scheduler.statuses().map((j) => j.name)).not.toContain("premium:-");
    expect(lines.some((l) => l.includes("premium dataset is skipped"))).toBe(true);
    const port = await app.start();
    await app.scheduler.tick("fear-greed:-");
    expect(app.health().ok).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(503);
    await app.stop();
  });
  it("with REDIS_URL the store is Redis (errors logged) and the default socket and fetch are used", async () => {
    FakeRedis.instances = [];
    FakeWs.instances = [];
    const lines: string[] = [];
    const app = createApp(loadConfig({ ...env, REDIS_URL: "redis://localhost:6379" }), { log: createLogger("warn", (l) => lines.push(l)) });
    expect(app.health().store).toBe("redis");
    expect(FakeRedis.instances).toHaveLength(1);
    FakeRedis.instances[0]!.listeners[0]!(new Error("redis down"));
    expect(lines.some((l) => l.includes("redis error"))).toBe(true);
    await app.start();
    expect(FakeWs.instances.map((w) => w.url)).toEqual(["wss://fstream.binance.com/ws/!forceOrder@arr", "wss://stream.bybit.com/v5/public/linear"]);
    await app.stop();
  });
  it("stops cleanly even when never started", async () => {
    const app = createApp(loadConfig(env), { fetch: healthyFetch().fetch, stream: false });
    await app.stop();
    expect(app.health().store).toBe("memory");
  });
});

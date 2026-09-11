/**
 * Fake ioredis for the gateway tests: one shared in-memory broker and key space per test file, so several
 * "connections" (pub, sub, coordination) and several gateway apps see the same state. Covers what the gateway uses:
 * publish / subscribe / unsubscribe / on / quit (pubsub), set NX PX / get / del / eval (leader lock and snapshot
 * store, PX expiry on an injectable clock) and hset / hdel / hgetall (held-topic registry).
 */
export class FakeRedis {
  static clients: FakeRedis[] = [];
  static kv = new Map<string, { value: string; until: number | null }>();
  static hashes = new Map<string, Map<string, string>>();
  static now: () => number = Date.now;
  /** When true every command rejects (Redis down). */
  static failCommands = false;
  /** When true quit() rejects (a connection already gone at shutdown). */
  static failQuit = false;
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
    FakeRedis.kv.clear();
    FakeRedis.hashes.clear();
    FakeRedis.failCommands = false;
    FakeRedis.failQuit = false;
    FakeRedis.now = Date.now;
  }

  private static live(key: string) {
    const k = FakeRedis.kv.get(key);
    if (k && k.until !== null && k.until <= FakeRedis.now()) FakeRedis.kv.delete(key);
    return FakeRedis.kv.get(key);
  }

  private guard(): Promise<never> | null {
    return FakeRedis.failCommands ? Promise.reject(new Error("redis down")) : null;
  }

  // ---- pubsub
  publish(channel: string, message: string): Promise<number> {
    const failed = this.guard();
    if (failed) return failed;
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
    const failed = this.guard();
    if (failed) return failed;
    for (const channel of channels) this.channels.add(channel);
    return Promise.resolve(channels.length);
  }
  unsubscribe(...channels: string[]): Promise<unknown> {
    const failed = this.guard();
    if (failed) return failed;
    for (const channel of channels) this.channels.delete(channel);
    return Promise.resolve(channels.length);
  }
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "message" | "error", listener: ((channel: string, message: string) => void) | ((error: Error) => void)): unknown {
    if (event === "message") this.listeners.message.push(listener as (channel: string, message: string) => void);
    else this.listeners.error.push(listener as (error: Error) => void);
    return this;
  }
  emitError(error: Error): void {
    for (const listener of this.listeners.error) listener(error);
  }
  inject(channel: string, message: string): void {
    for (const listener of this.listeners.message) listener(channel, message);
  }
  quit(): Promise<unknown> {
    this.quitCalls += 1;
    return FakeRedis.failQuit ? Promise.reject(new Error("connection closed")) : Promise.resolve("OK");
  }

  // ---- strings (lock + snapshot store)
  set(key: string, value: string, px?: "PX", ttlMs?: number, nx?: "NX"): Promise<"OK" | null> {
    const failed = this.guard();
    if (failed) return failed;
    if (nx === "NX" && FakeRedis.live(key)) return Promise.resolve(null);
    FakeRedis.kv.set(key, { value, until: px === "PX" && ttlMs !== undefined ? FakeRedis.now() + ttlMs : null });
    return Promise.resolve("OK");
  }
  get(key: string): Promise<string | null> {
    const failed = this.guard();
    if (failed) return failed;
    return Promise.resolve(FakeRedis.live(key)?.value ?? null);
  }
  del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (FakeRedis.kv.delete(key)) n += 1;
    return Promise.resolve(n);
  }
  /** Only the two compare-and-set scripts of the leader lock are understood. */
  eval(script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const failed = this.guard();
    if (failed) return failed;
    const [key, owner, ttl] = args as [string, string, string | number | undefined];
    const k = FakeRedis.live(key);
    if (!k || k.value !== owner) return Promise.resolve(0);
    if (script.includes("pexpire")) k.until = FakeRedis.now() + Number(ttl);
    else FakeRedis.kv.delete(key);
    return Promise.resolve(1);
  }

  // ---- hashes (registry)
  hset(key: string, ...fieldValues: (string | number)[]): Promise<number> {
    const failed = this.guard();
    if (failed) return failed;
    let hash = FakeRedis.hashes.get(key);
    if (!hash) {
      hash = new Map();
      FakeRedis.hashes.set(key, hash);
    }
    let added = 0;
    for (let i = 0; i + 1 < fieldValues.length; i += 2) {
      const field = String(fieldValues[i]);
      if (!hash.has(field)) added += 1;
      hash.set(field, String(fieldValues[i + 1]));
    }
    return Promise.resolve(added);
  }
  hdel(key: string, ...fields: string[]): Promise<number> {
    const failed = this.guard();
    if (failed) return failed;
    const hash = FakeRedis.hashes.get(key);
    let n = 0;
    for (const field of fields) if (hash?.delete(field)) n += 1;
    return Promise.resolve(n);
  }
  hgetall(key: string): Promise<Record<string, string>> {
    const failed = this.guard();
    if (failed) return failed;
    return Promise.resolve(Object.fromEntries(FakeRedis.hashes.get(key) ?? []));
  }
}

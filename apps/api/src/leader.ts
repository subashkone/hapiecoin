/**
 * Leader election by Redis lock (roadmap F26; GAPS #16, #71; ADR-062). One key, one owner: `SET key owner NX PX ttl`
 * takes it, and renewing or releasing runs a compare-and-set script so only the owner can extend or drop it. A
 * process that stops renewing (crash, network partition) loses the key after `ttlMs` and another one takes over.
 * Without Redis the memory lock makes the single process the leader.
 *
 * The same module lives in apps/gateway/src/leader.ts on purpose (two runtime packages, one small file each) so the
 * API jobs and the gateway feed share one behaviour without a new workspace package.
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

export interface LeaderLock {
  /** Take `key` for `ttlMs` when nobody holds it (or the owner already does). */
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Extend the lease when `owner` still holds it; false means it was lost. */
  renew(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Drop the lease when `owner` holds it. */
  release(key: string, owner: string): Promise<void>;
}

/** The slice of ioredis the Redis lock uses; tests pass a fake. */
export interface RedisLockClient {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const RENEW_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';
const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export class RedisLeaderLock implements LeaderLock {
  constructor(private readonly redis: RedisLockClient) {}

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    if ((await this.redis.set(key, owner, "PX", ttlMs, "NX")) === "OK") return true;
    // the owner re-acquiring after a hiccup: a renew succeeds only if the key is still ours
    return this.renew(key, owner, ttlMs);
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<boolean> {
    return Number(await this.redis.eval(RENEW_SCRIPT, 1, key, owner, ttlMs)) === 1;
  }

  async release(key: string, owner: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, owner);
  }
}

/** Single-process lock: the first owner wins until it releases or its lease lapses on the injected clock. */
export class MemoryLeaderLock implements LeaderLock {
  private readonly leases = new Map<string, { owner: string; until: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const lease = this.leases.get(key);
    if (lease && lease.owner !== owner && lease.until > this.now()) return Promise.resolve(false);
    this.leases.set(key, { owner, until: this.now() + ttlMs });
    return Promise.resolve(true);
  }

  renew(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const lease = this.leases.get(key);
    if (!lease || lease.owner !== owner || lease.until <= this.now()) return Promise.resolve(false);
    lease.until = this.now() + ttlMs;
    return Promise.resolve(true);
  }

  release(key: string, owner: string): Promise<void> {
    const lease = this.leases.get(key);
    if (lease && lease.owner === owner) this.leases.delete(key);
    return Promise.resolve();
  }
}

export function leaderOwnerId(): string {
  return `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
}

export interface RunAsLeaderOptions {
  lock: LeaderLock;
  key: string;
  owner?: string;
  /** Lease length; a dead leader is replaced within this time (default 15 s). */
  ttlMs?: number;
  /** How often the lease is renewed while held, and how often a standby retries (default ttl / 3). */
  renewMs?: number;
  /** A lock call that takes longer than this counts as lost (default ttl / 2): a hung Redis connection must not keep a stale leader. */
  timeoutMs?: number;
  /** Called once when the lease is taken; may be async. */
  onAcquire: () => void | Promise<void>;
  /** Called once when the lease is lost or given up. */
  onLose: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export interface LeaderHandle {
  /** True while this process holds the lease. */
  isLeader(): boolean;
  /** Stop renewing, release the lease (calling onLose when it was held) and end the loop. */
  stop(): Promise<void>;
  /** Resolves after the next acquire attempt or renew completes (tests). */
  tick(): Promise<void>;
}

/**
 * Keep trying to hold the lease: acquire, renew every `renewMs`, and on a failed renew or a Redis error give the
 * role up (`onLose`) and go back to trying. `onAcquire` and `onLose` always alternate, starting with `onAcquire`.
 */
export function runAsLeader(options: RunAsLeaderOptions): LeaderHandle {
  const ttlMs = options.ttlMs ?? 15_000;
  const renewMs = options.renewMs ?? Math.max(500, Math.floor(ttlMs / 3));
  const timeoutMs = options.timeoutMs ?? Math.max(1_000, Math.floor(ttlMs / 2));
  const owner = options.owner ?? leaderOwnerId();
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const onError = options.onError ?? (() => undefined);
  let leader = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const lose = async () => {
    if (!leader) return;
    leader = false;
    try {
      await options.onLose();
    } catch (error) {
      onError(error);
    }
  };

  /** The lock call must answer within `timeoutMs`; ioredis queues commands while disconnected, so a plain await could hang past the lease. */
  const bounded = <T>(call: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let done = false;
      const guard = setTimer(() => {
        if (done) return;
        done = true;
        reject(new Error(`lock call timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      call.then(
        (value) => {
          if (done) return;
          done = true;
          clearTimer(guard);
          resolve(value);
        },
        (error: unknown) => {
          if (done) return;
          done = true;
          clearTimer(guard);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

  const step = async () => {
    if (stopped) return;
    try {
      const held = leader ? await bounded(options.lock.renew(options.key, owner, ttlMs)) : await bounded(options.lock.acquire(options.key, owner, ttlMs));
      if (stopped) {
        // stop() arrived while the lock call was in flight: never take the role now; give back a fresh lease
        if (held && !leader) await options.lock.release(options.key, owner).catch(onError);
        return;
      }
      if (held && !leader) {
        try {
          await options.onAcquire();
          leader = true;
        } catch (error) {
          // the role could not be taken (the feed did not start, a job threw): give the lease back and retry later
          onError(error);
          await options.lock.release(options.key, owner).catch(onError);
        }
      } else if (!held && leader) {
        await lose();
      }
    } catch (error) {
      onError(error);
      await lose();
    }
    if (!stopped) timer = setTimer(() => void run(), renewMs);
  };
  const run = () => {
    inFlight = step();
    return inFlight;
  };
  void run();

  return {
    isLeader: () => leader,
    tick: () => inFlight,
    stop: async () => {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      await inFlight;
      const wasLeader = leader;
      await lose();
      if (wasLeader) {
        try {
          await options.lock.release(options.key, owner);
        } catch (error) {
          onError(error);
        }
      }
    },
  };
}

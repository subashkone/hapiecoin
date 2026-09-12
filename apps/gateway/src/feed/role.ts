/**
 * RoleFeed (ADR-062): the feed the server talks to, in one of two modes.
 * - leader: the wrapped MarketFeed owns the venue socket and publishes frames; it watches its own clients' topics
 *   at once and, every `syncMs`, the union of topics every other gateway registered.
 * - follower: no socket. Client holds go to the registry so the leader watches them; the first frame of a
 *   subscription comes from the shared snapshot store (waiting briefly for the leader to write it), and live
 *   frames arrive through the Redis fan-out like everywhere else.
 * Mode changes at runtime (leader lease taken or lost) never touch client connections.
 */
import type { Topic, Underlying } from "@hapiecoin/schema";
import type { HoldRegistry } from "../coordination/registry.js";
import type { SnapshotStore } from "../coordination/snapshots.js";
import { canonicalTopic } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import type { FeedStatus, MarketFeed, Snapshot, SpotState } from "./feed.js";

export type FeedRole = "leader" | "follower";

export interface RoleFeedOptions {
  feed: MarketFeed;
  registry: HoldRegistry;
  store: SnapshotStore;
  /** Registry read (leader) and re-lease (everyone) interval (default 2 s). */
  syncMs?: number;
  /** How long a follower waits for the leader to publish a first snapshot of a newly held topic (default 2.5 s). */
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  log?: Logger;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class RoleFeed {
  private readonly feed: MarketFeed;
  private readonly registry: HoldRegistry;
  private readonly store: SnapshotStore;
  private readonly syncMs: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly setTimer: NonNullable<RoleFeedOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<RoleFeedOptions["clearTimer"]>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly holds = new Map<Topic, number>();
  private mode: FeedRole = "follower";
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private syncing = false;
  private syncs = 0;

  constructor(options: RoleFeedOptions) {
    this.feed = options.feed;
    this.registry = options.registry;
    this.store = options.store;
    this.syncMs = options.syncMs ?? 2_000;
    this.waitMs = options.waitMs ?? 2_500;
    this.pollMs = options.pollMs ?? 250;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? silentLogger;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  role(): FeedRole {
    return this.mode;
  }

  /** Load the instrument list (follower mode) and start the registry sync loop. */
  async start(): Promise<void> {
    this.running = true;
    await this.feed.startFollower();
    this.armSync();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.syncTimer !== null) {
      this.clearTimer(this.syncTimer);
      this.syncTimer = null;
    }
    this.feed.stop();
    this.mode = "follower";
    await this.registry.clear().catch((error: unknown) => this.log.warn("registry clear failed", { error: toError(error) }));
  }

  /** The lease is ours: open the socket (which re-watches every locally held topic), then take the registry's topics. */
  async becomeLeader(): Promise<void> {
    if (this.mode === "leader") return;
    this.feed.promote(); // throws if the venue session cannot start: the lease is then given back by the caller
    this.mode = "leader";
    await this.sync();
    this.log.info("feed role", { role: "leader" });
  }

  /** The lease is gone: close the socket and stop watching; clients keep their subscriptions. */
  becomeFollower(): void {
    if (this.mode === "follower") return;
    this.mode = "follower";
    this.feed.demote();
    this.log.info("feed role", { role: "follower" });
  }

  status(): FeedStatus {
    return { ...this.feed.status(), role: this.mode };
  }

  supports(topic: Topic): boolean {
    return this.feed.supports(topic);
  }

  seq(topic: Topic): number {
    return this.feed.seq(topic);
  }

  /** Holds are counted once, in the feed (its upstream work is a no-op while it is not the feed); the registry sees the first and the last. */
  acquire(raw: Topic): void {
    const topic = canonicalTopic(raw); // ADR-071: one hold per canonical topic, like the feed
    const count = (this.holds.get(topic) ?? 0) + 1;
    this.holds.set(topic, count);
    this.feed.acquire(topic);
    if (count === 1) this.registry.hold(topic).catch((error: unknown) => this.log.warn("registry hold failed", { topic, error: toError(error) }));
  }

  release(raw: Topic): void {
    const topic = canonicalTopic(raw);
    const count = this.holds.get(topic);
    if (count === undefined) return;
    if (count > 1) {
      this.holds.set(topic, count - 1);
      this.feed.release(topic);
      return;
    }
    this.holds.delete(topic);
    this.feed.release(topic);
    this.registry.drop(topic).catch((error: unknown) => this.log.warn("registry drop failed", { topic, error: toError(error) }));
  }

  /** Leader: the live rows, synchronously. Follower: the leader's stored rows, waited for briefly, else the local REST rows at seq 0. */
  snapshot(topic: Topic): Snapshot | null | Promise<Snapshot | null> {
    if (this.mode === "leader") return this.feed.snapshot(topic);
    return this.followerSnapshot(topic);
  }

  private async followerSnapshot(topic: Topic): Promise<Snapshot | null> {
    const deadline = this.now() + this.waitMs;
    while (this.role() === "follower") {
      const stored = await this.store.getSnapshot(topic).catch((error: unknown) => {
        this.log.warn("snapshot store read failed", { topic, error: toError(error) });
        return null;
      });
      if (stored !== null) return { seq: stored.seq, rows: stored.rows };
      if (this.now() >= deadline) break;
      await this.sleep(this.pollMs);
    }
    if (this.role() === "leader") return this.feed.snapshot(topic); // promoted while waiting
    const local = this.feed.snapshot(topic);
    return local === null ? null : { seq: 0, rows: local.rows };
  }

  spot(underlying: Underlying, venue: string = DEFAULT_VENUE): SpotState | null | Promise<SpotState | null> {
    if (this.mode === "leader") return this.feed.spot(underlying, venue);
    return this.followerSpot(underlying, venue);
  }

  private async followerSpot(underlying: Underlying, venue: string): Promise<SpotState | null> {
    const stored = await this.store.getSpot(venue, underlying).catch(() => null);
    if (stored !== null) return { p: stored.p, ts: stored.ts };
    return this.feed.spot(underlying, venue);
  }

  /** Re-lease our holds; as leader also watch what other gateways hold. Exposed for tests. */
  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.registry.heartbeat();
      this.syncs += 1;
      if (this.mode === "leader") {
        const live = await this.registry.liveTopics();
        for (const topic of this.holds.keys()) live.delete(topic);
        this.feed.setRemoteTopics(live);
      } else if (this.syncs % 10 === 0) {
        await this.registry.liveTopics(); // reading prunes lapsed leases, so a leaderless or follower-only cluster does not accumulate them
      }
    } catch (error) {
      this.log.warn("registry sync failed", { error: toError(error) });
    } finally {
      this.syncing = false;
    }
  }

  private armSync(): void {
    if (!this.running || this.syncTimer !== null) return;
    this.syncTimer = this.setTimer(() => {
      this.syncTimer = null;
      void this.sync().then(() => this.armSync());
    }, this.syncMs);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

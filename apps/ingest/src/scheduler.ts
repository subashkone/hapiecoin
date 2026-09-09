/**
 * Runs each job on its interval, never overlapping itself, and records the outcome for /healthz. A failed run keeps
 * the previous snapshot in the store but re-writes it with `stale: true` so readers can show the badge (ADR-038).
 */
import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import type { Logger } from "./log.js";
import type { SnapshotStore } from "./store.js";
import { TTL_MULTIPLIER } from "./store.js";

export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<AnalyticsSnapshot>;
}

export interface JobStatus {
  name: string;
  intervalMs: number;
  runs: number;
  failures: number;
  lastOkAt: number | null;
  lastError: string | null;
  running: boolean;
}

export interface SchedulerOptions {
  store: SnapshotStore;
  log: Logger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Spread the first runs so boot does not burst every provider at once (default 250 ms apart). */
  staggerMs?: number;
}

export class Scheduler {
  private readonly store: SnapshotStore;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly staggerMs: number;
  private readonly jobs = new Map<string, { job: Job; status: JobStatus; timer: unknown }>();
  private stopped = false;

  constructor(opts: SchedulerOptions) {
    this.store = opts.store;
    this.log = opts.log;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.staggerMs = opts.staggerMs ?? 250;
  }

  add(job: Job): void {
    if (this.jobs.has(job.name)) throw new Error(`duplicate job ${job.name}`);
    this.jobs.set(job.name, { job, status: { name: job.name, intervalMs: job.intervalMs, runs: 0, failures: 0, lastOkAt: null, lastError: null, running: false }, timer: null });
  }

  start(): void {
    this.stopped = false;
    let i = 0;
    for (const entry of this.jobs.values()) {
      entry.timer = this.setTimer(() => void this.tick(entry.job.name), i * this.staggerMs);
      i += 1;
    }
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.jobs.values()) {
      if (entry.timer !== null) this.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  statuses(): JobStatus[] {
    return [...this.jobs.values()].map((e) => ({ ...e.status }));
  }

  /** Run one job now (tests and the boot stagger call this); reschedules itself unless stopped. */
  async tick(name: string): Promise<void> {
    const entry = this.jobs.get(name);
    if (!entry) throw new Error(`unknown job ${name}`);
    if (entry.status.running) return;
    entry.status.running = true;
    entry.status.runs += 1;
    const startedAt = this.now();
    try {
      const snapshot = await entry.job.run();
      await this.store.set(snapshot, snapshot.ttlMs * TTL_MULTIPLIER);
      entry.status.lastOkAt = this.now();
      entry.status.lastError = null;
      this.log.debug("job ok", { job: name, ms: this.now() - startedAt, key: snapshot.key, stale: snapshot.stale });
    } catch (error) {
      entry.status.failures += 1;
      entry.status.lastError = error instanceof Error ? error.message : String(error);
      this.log.warn("job failed", { job: name, error: error instanceof Error ? error : new Error(String(error)) });
      await this.markStale(entry.job);
    } finally {
      entry.status.running = false;
      if (!this.stopped) entry.timer = this.setTimer(() => void this.tick(name), entry.job.intervalMs);
    }
  }

  /** Re-write the previous snapshot flagged stale; the job name doubles as the store key. */
  private async markStale(job: Job): Promise<void> {
    try {
      const previous = await this.store.get(job.name);
      if (previous && !previous.stale) await this.store.set({ ...previous, stale: true }, previous.ttlMs * TTL_MULTIPLIER);
    } catch (error) {
      this.log.warn("could not mark snapshot stale", { job: job.name, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
}

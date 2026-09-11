/**
 * Background jobs under a leader lock (roadmap F26; GAPS #71; ADR-062). The reconciler, the IV snapshotter (with
 * the alerts pass), the settler and the Telegram linker used to start unconditionally in every API process, so a
 * second replica double-ran them. Now `API_JOBS_ROLE` decides:
 * - leader (default): run while this process holds the Redis lease `hapiecoin:leader:api-jobs`; a standby replica
 *   takes over within the lease TTL when the leader stops renewing. Without Redis the memory lock makes the single
 *   process the leader, so a one-copy deployment behaves as before.
 * - always: run unconditionally (a single replica that has Redis but wants no election).
 * - off: this copy only serves HTTP.
 */
import type { LeaderHandle, LeaderLock } from "./leader.js";
import { runAsLeader } from "./leader.js";

export type JobsRole = "leader" | "always" | "off";

export interface JobStarter {
  name: string;
  /** Start the job; returns its stop function. */
  start: () => () => void;
}

export interface JobsStatus {
  role: JobsRole;
  /** True while the jobs are running in this process. */
  active: boolean;
}

export interface JobsHandle {
  status(): JobsStatus;
  stop(): Promise<void>;
  /** Resolves after the leader loop's current step (tests). */
  tick(): Promise<void>;
}

export interface StartJobsOptions {
  role: JobsRole;
  lock: LeaderLock;
  starters: readonly JobStarter[];
  key?: string;
  ttlMs?: number;
  renewMs?: number;
  log: { info(o: object, msg: string): void; warn(o: object, msg: string): void; error(o: object, msg: string): void };
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export const API_JOBS_LEADER_KEY = "hapiecoin:leader:api-jobs";

export function startJobs(options: StartJobsOptions): JobsHandle {
  const { role, starters, log } = options;
  let stops: { name: string; stop: () => void }[] = [];
  let active = false;

  const startAll = () => {
    if (active) return;
    active = true;
    for (const s of starters) {
      try {
        stops.push({ name: s.name, stop: s.start() });
      } catch (error) {
        log.error({ job: s.name, error }, "job failed to start");
      }
    }
    log.info({ role, jobs: stops.map((s) => s.name) }, "background jobs started");
  };
  const stopAll = () => {
    if (!active) return;
    active = false;
    for (const s of stops) {
      try {
        s.stop();
      } catch (error) {
        log.error({ job: s.name, error }, "job failed to stop");
      }
    }
    stops = [];
    log.info({ role }, "background jobs stopped");
  };

  if (role === "off") return { status: () => ({ role, active: false }), stop: () => Promise.resolve(), tick: () => Promise.resolve() };
  if (role === "always") {
    startAll();
    return {
      status: () => ({ role, active }),
      stop: () => {
        stopAll();
        return Promise.resolve();
      },
      tick: () => Promise.resolve(),
    };
  }
  const handle: LeaderHandle = runAsLeader({
    lock: options.lock,
    key: options.key ?? API_JOBS_LEADER_KEY,
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    ...(options.renewMs !== undefined ? { renewMs: options.renewMs } : {}),
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
    onAcquire: () => {
      log.info({}, "this replica leads the background jobs");
      startAll();
    },
    onLose: () => {
      log.warn({}, "lost the jobs lease; standing by");
      stopAll();
    },
    onError: (error) => log.warn({ error }, "jobs lease error"),
  });
  return {
    status: () => ({ role, active }),
    stop: () => handle.stop(),
    tick: () => handle.tick(),
  };
}

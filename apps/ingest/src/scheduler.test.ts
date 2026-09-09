import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./log.js";
import { Scheduler } from "./scheduler.js";
import { MemoryStore } from "./store.js";

const snap = (stale = false): AnalyticsSnapshot => ({ dataset: "fear-greed", key: "fear-greed:-", source: "alternative.me", asOf: 1, ttlMs: 1000, stale, data: { points: [], latest: { value: 1, label: "Extreme Fear", at: 1 } } });

function harness() {
  const timers: { fn: () => void; ms: number }[] = [];
  const lines: string[] = [];
  const store = new MemoryStore(() => 5);
  const s = new Scheduler({ store, log: createLogger("debug", (l) => lines.push(l)), now: () => 5, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: (h) => { timers.splice(Number(h) - 1, 1, { fn: () => undefined, ms: -1 }); }, staggerMs: 10 });
  return { s, timers, lines, store };
}

describe("[INGEST] Scheduler", () => {
  it("staggers first runs, reschedules after each run, records outcomes and marks the previous snapshot stale on failure", async () => {
    const { s, timers, lines, store } = harness();
    let fail = false;
    s.add({ name: "fear-greed:-", intervalMs: 100, run: () => (fail ? Promise.reject(new Error("upstream down")) : Promise.resolve(snap())) });
    s.add({ name: "other", intervalMs: 200, run: () => Promise.resolve(snap()) });
    expect(() => s.add({ name: "other", intervalMs: 1, run: () => Promise.resolve(snap()) })).toThrow("duplicate job other");
    s.start();
    expect(timers.map((t) => t.ms)).toEqual([0, 10]);
    await s.tick("fear-greed:-");
    expect(await store.get("fear-greed:-")).toEqual(snap());
    expect(timers.at(-1)?.ms).toBe(100);
    let st = s.statuses().find((j) => j.name === "fear-greed:-")!;
    expect(st).toMatchObject({ runs: 1, failures: 0, lastOkAt: 5, lastError: null, running: false });
    fail = true;
    await s.tick("fear-greed:-");
    st = s.statuses().find((j) => j.name === "fear-greed:-")!;
    expect(st).toMatchObject({ runs: 2, failures: 1, lastError: "upstream down" });
    expect((await store.get("fear-greed:-"))?.stale).toBe(true);
    const writes = lines.filter((l) => l.includes("job ok")).length;
    await s.tick("fear-greed:-"); // already stale: no rewrite needed
    expect(lines.filter((l) => l.includes("job ok")).length).toBe(writes);
    expect(lines.some((l) => l.includes("job failed"))).toBe(true);
    timers.at(-1)!.fn(); // the reschedule callback armed by the last tick (still failing, previous already stale)
    await new Promise((r) => setTimeout(r, 0));
    expect(s.statuses().find((j) => j.name === "fear-greed:-")?.failures).toBe(3);
    fail = false;
    timers[0]!.fn(); // the staggered first-run callback
    await new Promise((r) => setTimeout(r, 0));
    expect(s.statuses().find((j) => j.name === "fear-greed:-")?.runs).toBe(5);
    await expect(s.tick("nope")).rejects.toThrow("unknown job nope");
    s.stop();
    await s.tick("other");
    expect(timers.filter((t) => t.ms === 200)).toHaveLength(0); // stopped: no reschedule
  });
  it("skips a tick while the same job is still running and survives a store failure while marking stale", async () => {
    const { s, lines } = harness();
    let resolve!: (v: AnalyticsSnapshot) => void;
    s.add({ name: "slow", intervalMs: 50, run: () => new Promise<AnalyticsSnapshot>((r) => { resolve = r; }) });
    const first = s.tick("slow");
    await s.tick("slow");
    expect(s.statuses()[0]?.runs).toBe(1);
    resolve(snap());
    await first;
    const broken = new Scheduler({ store: { get: () => Promise.reject(new Error("redis gone")), set: () => Promise.resolve(), appendSeries: () => Promise.resolve([]), close: () => Promise.resolve() }, log: createLogger("debug", (l) => lines.push(l)), setTimer: () => 0, clearTimer: () => undefined });
    broken.add({ name: "x", intervalMs: 1, run: () => Promise.reject(new Error("no")) });
    await broken.tick("x");
    expect(lines.some((l) => l.includes("could not mark snapshot stale"))).toBe(true);
    const thrown = new Scheduler({ store: { get: () => Promise.resolve(null), set: () => Promise.resolve(), appendSeries: () => Promise.resolve([]), close: () => Promise.resolve() }, log: createLogger("silent"), setTimer: () => 0, clearTimer: () => undefined });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error path must be covered
    thrown.add({ name: "y", intervalMs: 1, run: () => Promise.reject("string failure") });
    await thrown.tick("y");
    expect(thrown.statuses()[0]?.lastError).toBe("string failure");
  });
  it("uses real timers by default", () => {
    vi.useFakeTimers();
    const s = new Scheduler({ store: new MemoryStore(), log: createLogger("silent") });
    s.add({ name: "z", intervalMs: 1000, run: () => Promise.resolve(snap()) });
    s.start();
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

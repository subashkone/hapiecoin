import { ServerMessage } from "@hapiecoin/schema";
import type { Topic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Coalescer } from "./coalescer.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const OTHER: Topic = "chain:delta_india:ETH:2026-09-25";
const A = "delta_india:C-BTC-80000-250926";
const B = "delta_india:P-BTC-80000-250926";

function make(intervalMs = 250) {
  const emitted: { topic: string; message: ServerMessage }[] = [];
  const coalescer = new Coalescer({ intervalMs, emit: (topic, message) => emitted.push({ topic, message }) });
  return { coalescer, emitted };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[GATEWAY] coalescer", () => {
  it("[GATEWAY] flushes once per interval with one merged delta per instrument and a monotonic seq", () => {
    const { coalescer, emitted } = make();
    coalescer.addQuote(TOPIC, { i: A, mark: "1", bid: "0.9" });
    coalescer.addQuote(TOPIC, { i: A, mark: "2", ask: "2.1" });
    coalescer.addQuote(TOPIC, { i: B, mark: "5" });
    expect(coalescer.pending()).toBe(2);
    expect(coalescer.seq(TOPIC)).toBe(0);

    vi.advanceTimersByTime(249);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      topic: TOPIC,
      message: {
        t: "q",
        topic: TOPIC,
        seq: 1,
        d: [
          { i: A, mark: "2", bid: "0.9", ask: "2.1" },
          { i: B, mark: "5" },
        ],
      },
    });
    expect(ServerMessage.parse(emitted[0]?.message)).toEqual(emitted[0]?.message);
    expect(coalescer.seq(TOPIC)).toBe(1);
    expect(coalescer.pending()).toBe(0);

    // nothing pending: the timer is not re-armed and nothing is emitted
    vi.advanceTimersByTime(1000);
    expect(emitted).toHaveLength(1);

    // a later batch continues the sequence; topics are independent
    coalescer.addQuote(OTHER, { i: A, mark: "9" });
    coalescer.addQuote(TOPIC, { i: A, mark: "3" });
    vi.advanceTimersByTime(250);
    expect(emitted.map((e) => [e.topic, (e.message as { seq: number }).seq])).toEqual([
      [TOPIC, 1],
      [OTHER, 1],
      [TOPIC, 2],
    ]);
    coalescer.addQuote(TOPIC, { i: A, mark: "4" });
    coalescer.flush();
    expect(coalescer.seq(TOPIC)).toBe(3);
    expect(coalescer.seq(OTHER)).toBe(1);
    // the timer that was armed by the add was cleared by the manual flush
    vi.advanceTimersByTime(250);
    expect(emitted).toHaveLength(4);
  });

  it("[GATEWAY] batches spot ticks per underlying (last price wins) and carries c24 when present", () => {
    const { coalescer, emitted } = make(100);
    coalescer.setSpot("delta_india", "BTC", { p: "79500" });
    coalescer.setSpot("delta_india", "BTC", { p: "79510", c24: -0.95 });
    coalescer.setSpot("deribit", "BTC", { p: "79400" }); // another venue: its own key and topic (ADR-071)
    coalescer.setSpot("delta_india", "ETH", { p: "2400" });
    expect(coalescer.pending()).toBe(3);
    vi.advanceTimersByTime(100);
    expect(emitted).toEqual([
      { topic: "spot:delta_india:BTC", message: { t: "spot", s: "BTC", v: "delta_india", p: "79510", c24: -0.95 } },
      { topic: "spot:deribit:BTC", message: { t: "spot", s: "BTC", v: "deribit", p: "79400" } },
      { topic: "spot:delta_india:ETH", message: { t: "spot", s: "ETH", v: "delta_india", p: "2400" } },
    ]);
    for (const e of emitted) expect(ServerMessage.parse(e.message)).toEqual(e.message);
  });

  it("[GATEWAY] close drops pending data, stops the timer and keeps sequence numbers", () => {
    const { coalescer, emitted } = make();
    coalescer.addQuote(TOPIC, { i: A, mark: "1" });
    coalescer.flush();
    coalescer.addQuote(TOPIC, { i: A, mark: "2" });
    coalescer.setSpot("delta_india", "BTC", { p: "1" });
    coalescer.close();
    coalescer.close(); // idempotent
    expect(coalescer.pending()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(emitted).toHaveLength(1);
    expect(coalescer.seq(TOPIC)).toBe(1);
  });
});

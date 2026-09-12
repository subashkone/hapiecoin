/**
 * Batches quote deltas per topic and spot ticks per underlying, flushing every `intervalMs` (COALESCE_MS).
 * Within a batch a later delta for the same instrument merges over the earlier one, so a client sees
 * at most one delta per instrument per flush. Each flushed `q` frame carries a per-topic `seq` that
 * increases by exactly one; snapshots report the last flushed `seq` so clients can detect gaps.
 */
import { spotTopic } from "@hapiecoin/schema";
import type { QuoteDelta, ServerMessage, Topic, Underlying, Venue as VenueId } from "@hapiecoin/schema";
import { mergeDelta } from "./diff.js";

export interface SpotTick {
  p: string;
  c24?: number;
}

export interface CoalescerOptions {
  intervalMs: number;
  emit: (topic: Topic, message: ServerMessage) => void;
}

export class Coalescer {
  private readonly intervalMs: number;
  private readonly emit: CoalescerOptions["emit"];
  private readonly pendingQuotes = new Map<Topic, Map<string, QuoteDelta>>();
  /** Pending spot per `${venue}:${underlying}` (ADR-071). */
  private readonly pendingSpots = new Map<string, { venue: VenueId; underlying: Underlying; tick: SpotTick }>();
  private readonly seqs = new Map<Topic, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CoalescerOptions) {
    this.intervalMs = options.intervalMs;
    this.emit = options.emit;
  }

  addQuote(topic: Topic, delta: QuoteDelta): void {
    let byInstrument = this.pendingQuotes.get(topic);
    if (!byInstrument) {
      byInstrument = new Map();
      this.pendingQuotes.set(topic, byInstrument);
    }
    const existing = byInstrument.get(delta.i);
    if (existing) mergeDelta(existing, delta);
    else byInstrument.set(delta.i, { ...delta });
    this.arm();
  }

  setSpot(venue: VenueId, underlying: Underlying, tick: SpotTick): void {
    this.pendingSpots.set(`${venue}:${underlying}`, { venue, underlying, tick });
    this.arm();
  }

  /** Last flushed sequence number for the topic (0 before the first flush). */
  seq(topic: Topic): number {
    return this.seqs.get(topic) ?? 0;
  }

  /** Number of instruments and spots waiting for the next flush. */
  pending(): number {
    let n = this.pendingSpots.size;
    for (const byInstrument of this.pendingQuotes.values()) n += byInstrument.size;
    return n;
  }

  /** Emit everything pending now (also called by the timer). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [topic, byInstrument] of this.pendingQuotes) {
      const seq = this.seq(topic) + 1;
      this.seqs.set(topic, seq);
      this.emit(topic, { t: "q", topic, seq, d: [...byInstrument.values()] });
    }
    this.pendingQuotes.clear();
    for (const { venue, underlying, tick } of this.pendingSpots.values()) {
      const message: ServerMessage = { t: "spot", s: underlying, v: venue, p: tick.p };
      if (tick.c24 !== undefined) message.c24 = tick.c24;
      this.emit(spotTopic(underlying, venue), message);
    }
    this.pendingSpots.clear();
  }

  /** Drop pending data and stop the timer (shutdown). Sequence numbers are kept. */
  close(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingQuotes.clear();
    this.pendingSpots.clear();
  }

  private arm(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs);
  }
}

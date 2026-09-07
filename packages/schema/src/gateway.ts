import { z } from "zod";
import { DecimalString, UNDERLYINGS, Underlying, VENUES, type Venue } from "./primitives.js";
import { ChainRow, InstrumentId, Quote } from "./market.js";

const venueAlt = VENUES.join("|");
const underlyingAlt = UNDERLYINGS.join("|");
const symbolPat = "[A-Za-z0-9][A-Za-z0-9._-]*";
const datePat = "[0-9]{4}-[0-9]{2}-[0-9]{2}";

/** `chain:<venue>:<underlying>:<expiry>` — every quote of one chain (expiry is YYYY-MM-DD). */
export const CHAIN_TOPIC_RE = new RegExp(`^chain:(${venueAlt}):(${underlyingAlt}):(${datePat})$`);
/** `spot:<underlying>` — underlying spot price ticks. */
export const SPOT_TOPIC_RE = new RegExp(`^spot:(${underlyingAlt})$`);
/** `fut:<venue>:<symbol>` — one future or perpetual. */
export const FUT_TOPIC_RE = new RegExp(`^fut:(${venueAlt}):(${symbolPat})$`);

/** Subscription topic on the market-data gateway. */
export const Topic = z
  .string()
  .refine((t) => CHAIN_TOPIC_RE.test(t) || SPOT_TOPIC_RE.test(t) || FUT_TOPIC_RE.test(t), {
    message: "expected chain:<venue>:<underlying>:<YYYY-MM-DD>, spot:<underlying> or fut:<venue>:<symbol>",
  });
export type Topic = z.infer<typeof Topic>;

export function chainTopic(venue: Venue, underlying: Underlying, expiry: string): Topic {
  return `chain:${venue}:${underlying}:${expiry}`;
}
export function spotTopic(underlying: Underlying): Topic {
  return `spot:${underlying}`;
}
export function futTopic(venue: Venue, symbol: string): Topic {
  return `fut:${venue}:${symbol}`;
}

export type ParsedTopic =
  | { kind: "chain"; venue: Venue; underlying: Underlying; expiry: string }
  | { kind: "spot"; underlying: Underlying }
  | { kind: "fut"; venue: Venue; symbol: string };

/** Split a topic into its parts, or return null when it matches no pattern. */
export function parseTopic(topic: string): ParsedTopic | null {
  const chain = CHAIN_TOPIC_RE.exec(topic);
  if (chain) {
    return { kind: "chain", venue: chain[1] as Venue, underlying: chain[2] as Underlying, expiry: chain[3] as string };
  }
  const spot = SPOT_TOPIC_RE.exec(topic);
  if (spot) return { kind: "spot", underlying: spot[1] as Underlying };
  const fut = FUT_TOPIC_RE.exec(topic);
  if (fut) return { kind: "fut", venue: fut[1] as Venue, symbol: fut[2] as string };
  return null;
}

/** Upper bound on topics per sub/unsub frame; keeps a single frame small and bounded. */
export const MAX_TOPICS_PER_MESSAGE = 200;

export const ClientMessage = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sub"), topics: z.array(Topic).min(1).max(MAX_TOPICS_PER_MESSAGE) }),
  z.object({ op: z.literal("unsub"), topics: z.array(Topic).min(1).max(MAX_TOPICS_PER_MESSAGE) }),
  z.object({ op: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Monotonic per-topic sequence number so clients can detect gaps and request a fresh snapshot. */
export const Seq = z.number().int().nonnegative();
export type Seq = z.infer<typeof Seq>;

/**
 * Incremental quote update: the instrument id under `i` plus only the fields that changed.
 * Field names match `Quote`; at least one changed field must be present.
 */
export const QuoteDelta = z
  .object({ i: InstrumentId })
  .extend(Quote.omit({ instrumentId: true }).partial().shape)
  .refine((d) => Object.keys(d).length > 1, { message: "a quote delta must carry at least one changed field" });
export type QuoteDelta = z.infer<typeof QuoteDelta>;

export const ServerMessage = z.discriminatedUnion("t", [
  /** Full chain rows for a topic; replaces any client state for that topic. */
  z.object({ t: z.literal("snap"), topic: Topic, seq: Seq, rows: z.array(ChainRow) }),
  /** Quote deltas for a topic, to be applied on top of the last snapshot. */
  z.object({ t: z.literal("q"), topic: Topic, seq: Seq, d: z.array(QuoteDelta).min(1) }),
  /** Spot tick: underlying, price and optional 24h change in percent. */
  z.object({ t: z.literal("spot"), s: Underlying, p: DecimalString, c24: z.number().finite().optional() }),
  z.object({ t: z.literal("pong") }),
  z.object({ t: z.literal("err"), code: z.string().min(1), message: z.string().min(1) }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

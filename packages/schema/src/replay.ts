/**
 * Replay of an expiry's chain (ADR-079; HC-WS-113, HC-WS-114): the instants the venue's chain was recorded at, daily
 * from the end-of-day table and every five minutes over the last week from the mark stream, and the ladder at one of
 * them. Chart data (numbers), never money; what is shown is what was recorded, nothing modelled.
 */
import { z } from "zod";
import { DecimalString, IsoDate, IsoDateTime, Underlying, Venue } from "./primitives.js";

/** The 5-minute stream is kept this many days (ADR-056); replay at that resolution reaches no further. */
export const REPLAY_FINE_DAYS = 7;

export const ReplayExpiries = z.strictObject({
  asset: Underlying,
  venue: Venue,
  /** Expiries with any recorded chain, soonest first: the end-of-day days held and whether the venue still lists it. */
  expiries: z.array(z.strictObject({ expiry: IsoDate, days: z.number().int().nonnegative(), listed: z.boolean() })),
});
export type ReplayExpiries = z.infer<typeof ReplayExpiries>;

export const ReplayStep = z.strictObject({ ts: IsoDateTime, spot: z.number().finite().positive() });
export type ReplayStep = z.infer<typeof ReplayStep>;

export const ReplaySteps = z.strictObject({
  asset: Underlying,
  venue: Venue,
  expiry: IsoDate,
  /** One instant per recorded end of day that carries the expiry, oldest first. */
  daily: z.array(z.strictObject({ day: IsoDate, ts: IsoDateTime, spot: z.number().finite().positive() })),
  /** Every recorded 5-minute pass over the last week that carries the expiry, oldest first. */
  fine: z.array(ReplayStep),
});
export type ReplaySteps = z.infer<typeof ReplaySteps>;

export const ReplayQuote = z.strictObject({
  mark: z.number().finite().nonnegative(),
  /** Mark IV as a fraction; null when the venue quoted none at that instant. */
  iv: z.number().finite().nonnegative().nullable(),
});
export type ReplayQuote = z.infer<typeof ReplayQuote>;

export const ReplayRow = z.strictObject({ strike: DecimalString, call: ReplayQuote.nullable(), put: ReplayQuote.nullable() });
export type ReplayRow = z.infer<typeof ReplayRow>;

export const ReplayChain = z.strictObject({
  asset: Underlying,
  venue: Venue,
  expiry: IsoDate,
  at: IsoDateTime,
  /** Where the ladder came from: the end-of-day table or the 5-minute mark stream. */
  source: z.enum(["eod", "marks"]),
  spot: z.number().finite().positive(),
  /** Ascending strikes. */
  rows: z.array(ReplayRow),
});
export type ReplayChain = z.infer<typeof ReplayChain>;

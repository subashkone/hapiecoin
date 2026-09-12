// Ops boundaries (roadmap item 27, ADR-081): a browser error report relayed to the error sink through the API, so no
// public DSN ships and the server scrubs before anything leaves.
import { z } from "zod";

export const ClientErrorBody = z.strictObject({
  message: z.string().trim().min(1).max(500),
  /** The error's name ("TypeError"); "Error" when absent. */
  name: z.string().trim().max(80).optional(),
  /** The browser's stack, capped; frames are parsed server-side. */
  stack: z.string().max(4_000).optional(),
  /** `location.pathname + location.search` of the page; the query is scrubbed server-side. */
  path: z.string().max(300).optional(),
  release: z.string().max(64).optional(),
  /** Where it was caught: a window `error`, an `unhandledrejection`, or a React error boundary. */
  kind: z.enum(["error", "unhandledrejection", "boundary"]).default("error"),
});
export type ClientErrorBody = z.infer<typeof ClientErrorBody>;

export const ClientErrorAck = z.object({
  /** The tracker's event id (shown to the trader as a reference), null when no sink is configured or the report was dropped. */
  eventId: z.string().nullable(),
});
export type ClientErrorAck = z.infer<typeof ClientErrorAck>;

/**
 * Wire encoding for server frames. JSON text frames today.
 *
 * Later optimisation (not in Phase 1): a msgpack encoder (`@msgpack/msgpack`) behind the same interface,
 * negotiated per connection via the `Sec-WebSocket-Protocol` header ("hapiecoin.msgpack") and sent as
 * binary frames. Decimal strings stay strings in either encoding, so nothing in `@hapiecoin/schema` changes.
 */
import type { ServerMessage } from "@hapiecoin/schema";

export interface FrameEncoder {
  /** Name reported in `/healthz`. */
  readonly name: string;
  /** True when frames are binary (msgpack); JSON frames are text. */
  readonly binary: boolean;
  encode(message: ServerMessage): string | Uint8Array;
}

export const jsonEncoder: FrameEncoder = {
  name: "json",
  binary: false,
  encode: (message) => JSON.stringify(message),
};

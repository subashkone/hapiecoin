import { ServerMessage } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { jsonEncoder } from "./encoder.js";

describe("[GATEWAY] json encoder", () => {
  it("[GATEWAY] encodes a ServerMessage as a text frame that parses back to the same message", () => {
    const message = {
      t: "q",
      topic: "chain:delta_india:BTC:2026-09-25",
      seq: 3,
      d: [{ i: "delta_india:C-BTC-80000-250926", mark: "1" }],
    };
    const frame = jsonEncoder.encode(ServerMessage.parse(message));
    expect(jsonEncoder.name).toBe("json");
    expect(jsonEncoder.binary).toBe(false);
    expect(typeof frame).toBe("string");
    expect(JSON.parse(frame as string)).toEqual(message);
  });
});

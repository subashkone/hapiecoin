import { describe, expect, it } from "vitest";
import { ClientErrorAck, ClientErrorBody } from "./ops.js";

describe("HC-SH-132 ClientErrorBody (ADR-081)", () => {
  it("takes a message with optional name, stack, path and release, defaults the kind, and refuses extras and oversized fields", () => {
    expect(ClientErrorBody.parse({ message: " boom " })).toEqual({ message: "boom", kind: "error" });
    expect(ClientErrorBody.parse({ message: "m", name: "TypeError", stack: "s", path: "/analyse?tab=chain", release: "r1", kind: "boundary" })).toEqual({ message: "m", name: "TypeError", stack: "s", path: "/analyse?tab=chain", release: "r1", kind: "boundary" });
    expect(ClientErrorBody.safeParse({ message: "" }).success).toBe(false);
    expect(ClientErrorBody.safeParse({ message: "m", stack: "x".repeat(4_001) }).success).toBe(false);
    expect(ClientErrorBody.safeParse({ message: "m", kind: "other" }).success).toBe(false);
    expect(ClientErrorBody.safeParse({ message: "m", extra: 1 }).success).toBe(false);
    expect(ClientErrorAck.parse({ eventId: null })).toEqual({ eventId: null });
    expect(ClientErrorAck.parse({ eventId: "abc" })).toEqual({ eventId: "abc" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, type MockFetch } from "../../../test/helpers";
import { MAX_STACK, REPORT_WINDOW_MS, describeError, installErrorReporting, reportError, resetErrorReporting } from "./report";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  resetErrorReporting();
});
afterEach(() => {
  mock.restore();
  window.history.replaceState(null, "", "/");
});

describe("HC-SH-132 browser error reporting (ADR-081)", () => {
  it("describes an Error, a string, a record with a message, and anything else", () => {
    const err = new TypeError("bad");
    expect(describeError(err)).toEqual({ name: "TypeError", message: "bad", stack: err.stack });
    expect(describeError("plain")).toEqual({ name: "Error", message: "plain" });
    expect(describeError("")).toEqual({ name: "Error", message: "Error" });
    expect(describeError({ name: "Custom", message: "m", stack: "s" })).toEqual({ name: "Custom", message: "m", stack: "s" });
    expect(describeError({ name: "", message: "m" })).toEqual({ name: "Error", message: "m" });
    expect(describeError({ code: 7 })).toEqual({ name: "Error", message: '{"code":7}' });
    expect(describeError(undefined)).toEqual({ name: "Error", message: "undefined" });
    const cyc: Record<string, unknown> = {};
    cyc["self"] = cyc;
    expect(describeError(cyc)).toEqual({ name: "Error", message: "[object Object]" });
    const noName = new Error("");
    noName.name = "";
    delete (noName as { stack?: string }).stack;
    expect(describeError(noName)).toEqual({ name: "Error", message: "Error" });
    const long = new Error("x");
    long.stack = "y".repeat(MAX_STACK + 1000);
    expect(describeError(long).stack).toHaveLength(MAX_STACK);
  });

  it("posts one report with the page path, kind, name and stack; a repeat within a minute answers the same id without a second post; after a minute it is sent again", async () => {
    window.history.replaceState(null, "", "/analyse?tab=chain&token=abc");
    const now = { value: 1_000_000 };
    const err = new RangeError("out of range");
    expect(await reportError(err, "unhandledrejection", { now: () => now.value })).toBe("mock-1");
    expect(mock.state.clientErrors).toEqual([{ message: "out of range", name: "RangeError", kind: "unhandledrejection", stack: err.stack, path: "/analyse?tab=chain&token=abc" }]);
    expect(await reportError(new RangeError("out of range"), "unhandledrejection", { now: () => now.value + 1_000 })).toBe("mock-1");
    expect(mock.state.clientErrors).toHaveLength(1);
    expect(await reportError(new RangeError("out of range"), "error", { now: () => now.value + 1_000 })).toBe("mock-2"); // another kind is another key
    now.value += REPORT_WINDOW_MS;
    expect(await reportError(new RangeError("out of range"), "unhandledrejection", { now: () => now.value })).toBe("mock-3");
  });

  it("a failed report resolves null without throwing, and a custom post seam and path are used as given", async () => {
    expect(await reportError(new Error("x"), "error", { post: () => Promise.reject(new Error("offline")) })).toBeNull();
    const posted: unknown[] = [];
    const id = await reportError("y", "boundary", {
      post: (b) => {
        posted.push(b);
        return Promise.resolve({ eventId: "e1" });
      },
      path: "/custom",
    });
    expect(id).toBe("e1");
    expect(posted[0]).toEqual({ message: "y", name: "Error", kind: "boundary", path: "/custom" });
  });

  it("installErrorReporting listens for window errors and unhandled rejections until removed", async () => {
    const posted: { kind: string; message: string }[] = [];
    const post = (b: { kind: string; message: string }) => {
      posted.push({ kind: b.kind, message: b.message });
      return Promise.resolve({ eventId: "e" });
    };
    const remove = installErrorReporting({ post });
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window boom"), message: "window boom" }));
    window.dispatchEvent(new ErrorEvent("error", { message: "no error object" }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = "promise boom";
    window.dispatchEvent(rejection);
    await vi.waitFor(() => expect(posted).toHaveLength(3));
    expect(posted).toEqual([
      { kind: "error", message: "window boom" },
      { kind: "error", message: "no error object" },
      { kind: "unhandledrejection", message: "promise boom" },
    ]);
    remove();
    window.dispatchEvent(new ErrorEvent("error", { message: "after removal" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(3);
  });
});

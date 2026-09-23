// The pricing client picks a Web Worker when the browser has one and the inline transport otherwise; the
// worker entry answers the same protocol. (HC-WS-049, frontend rule: pricing in a Web Worker.)
import { type MessageTransport, PricingClient, attachPricingWorker, createInlineTransport } from "@hapiecoin/pricing";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPricingClient, setPricingClientForTests, useAnalysis } from "./client";

const LEGS = [{ kind: "call" as const, side: "buy" as const, strike: 80000, expiry: "2026-09-25", quantity: 0.01, price: 1200, iv: 0.5 }];
const OPTS = { spot: 79521, nowMs: Date.UTC(2026, 8, 7, 12), settlementHourUtc: 12 };

/** A fake DOM Worker whose other side is the package's worker handler, so messages go through both adapters. */
class FakeWorker {
  static created = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private scope: MessageTransport;
  constructor() {
    FakeWorker.created += 1;
    this.scope = {
      postMessage: (m: unknown) => queueMicrotask(() => this.onmessage?.({ data: m })),
      onmessage: null,
    };
    attachPricingWorker(this.scope);
  }
  postMessage(m: unknown) {
    queueMicrotask(() => this.scope.onmessage?.({ data: m }));
  }
}

afterEach(() => {
  setPricingClientForTests(null);
  vi.unstubAllGlobals();
});

describe("getPricingClient", () => {
  it("uses the inline transport when there is no Worker and caches the client", async () => {
    const a = getPricingClient();
    expect(getPricingClient()).toBe(a);
    const r = await a.analyze(LEGS, OPTS);
    expect(r.points.length).toBeGreaterThan(10);
  });
  it("wraps a DOM Worker in the engine's transport when one exists", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("URL", class extends URL {});
    const before = FakeWorker.created;
    const c = getPricingClient();
    expect(FakeWorker.created).toBe(before + 1);
    const r = await c.analyze(LEGS, OPTS);
    expect(Number.isFinite(r.netPremium)).toBe(true);
  });
  it("falls back to the inline transport when the Worker constructor throws", () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("no module workers");
        }
      },
    );
    expect(() => getPricingClient()).not.toThrow();
  });
  it("HC-WS-049 falls back to the main thread when the Worker fails to load, so the next request still prices", async () => {
    // a worker whose script never arrives: it fires onerror and answers nothing
    class DeadWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      terminated = false;
      constructor() {
        queueMicrotask(() => this.onerror?.({ message: "Failed to fetch worker script" }));
      }
      postMessage() {}
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", DeadWorker);
    vi.stubGlobal("URL", class extends URL {});
    const first = getPricingClient();
    await new Promise((r) => setTimeout(r, 0));
    const second = getPricingClient();
    expect(second).not.toBe(first); // replaced by an inline client
    const r = await second.analyze(LEGS, OPTS);
    expect(Number.isFinite(r.maxLoss)).toBe(true);
    // a request that was in flight on the dead worker fails at once instead of hanging until the timeout
    await expect(first.analyze(LEGS, OPTS)).rejects.toThrow();
  });
});

describe("useAnalysis", () => {
  it("prices per animation frame and reports engine errors without dropping the last result", async () => {
    setPricingClientForTests(new PricingClient(createInlineTransport(), { timeoutMs: 2000 }));
    const { result, rerender } = renderHook(({ legs, opts }: { legs: typeof LEGS; opts: typeof OPTS | null }) => useAnalysis(legs, opts), { initialProps: { legs: LEGS, opts: OPTS } });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.pending).toBe(false);
    // an impossible spot makes the engine reject; the previous result stays and the error is reported
    act(() => {
      rerender({ legs: LEGS, opts: { ...OPTS, spot: -1 } });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.result).not.toBeNull();
    // no legs → empty state
    rerender({ legs: [], opts: OPTS });
    await waitFor(() => expect(result.current.result).toBeNull());
    expect(result.current.error).toBeNull();
  });
});

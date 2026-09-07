import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze, scenarioGrid } from "../strategy.js";
import type { Leg } from "../types.js";
import { PricingClient } from "./client.js";
import { attachPricingWorker, createInlineTransport, createPricingWorkerHandler } from "./handler.js";
import type { MessageTransport, PricingRequest, PricingResponse } from "./protocol.js";

const NOW = 1788543685911.107;
const SPOT = 79_528.1;
const legs: Leg[] = [
  { kind: "call", side: "buy", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 2500, iv: 0.42 },
  { kind: "call", side: "sell", strike: 82_000, expiry: "2026-09-25", quantity: 0.01, price: 1700, iv: 0.43 },
];
const analyzeOptions = { spot: SPOT, nowMs: NOW, points: 9 };
const scenarioOptions = { prices: [78_000, 80_000], dates: [NOW, NOW + 86_400_000] };

describe("[PRICING] worker handler", () => {
  const handle = createPricingWorkerHandler();

  it("[PRICING] answers analyze and scenario requests with the same result as a direct call", () => {
    const a = handle({ id: 1, op: "analyze", payload: { legs, options: analyzeOptions } });
    expect(a).toEqual({ id: 1, ok: true, result: analyze(legs, analyzeOptions) });
    const s = handle({ id: "s-1", op: "scenario", payload: { legs, options: scenarioOptions } });
    expect(s).toEqual({ id: "s-1", ok: true, result: scenarioGrid(legs, scenarioOptions) });
  });

  it("[PRICING] reports unknown ops, malformed messages and thrown errors as failures", () => {
    expect(handle({ id: 2, op: "greeks", payload: {} })).toEqual({ id: 2, ok: false, error: 'unknown pricing op "greeks"' });
    expect(handle(null)).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    expect(handle("analyze")).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    expect(handle({ op: "analyze", payload: {} })).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    expect(handle({ id: true, op: "analyze", payload: {} })).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    expect(handle({ id: 3, op: 4, payload: {} })).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    expect(handle({ id: 3, op: "analyze" })).toEqual({ id: null, ok: false, error: "malformed pricing request" });
    const bad = handle({ id: 4, op: "analyze", payload: { legs, options: { spot: 0, nowMs: NOW } } });
    expect(bad).toEqual({ id: 4, ok: false, error: expect.stringMatching(/positive finite/) as string });
    const payload = {
      get legs(): Leg[] {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "not an Error instance";
      },
      options: analyzeOptions,
    };
    expect(handle({ id: 5, op: "analyze", payload })).toEqual({ id: 5, ok: false, error: "pricing request failed" });
  });

  it("[PRICING] attachPricingWorker wires onmessage → postMessage on a worker scope", () => {
    const posted: unknown[] = [];
    const scope: MessageTransport = { onmessage: null, postMessage: (m) => posted.push(m) };
    const handler = attachPricingWorker(scope);
    expect(typeof handler).toBe("function");
    scope.onmessage?.({ data: { id: 7, op: "analyze", payload: { legs, options: analyzeOptions } } });
    expect(posted).toEqual([{ id: 7, ok: true, result: analyze(legs, analyzeOptions) }]);
  });
});

describe("[PRICING] PricingClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[PRICING] resolves analyze and scenario over the inline transport with unique request ids", async () => {
    const transport = createInlineTransport();
    const sent: PricingRequest[] = [];
    const post = transport.postMessage.bind(transport);
    transport.postMessage = (m) => {
      sent.push(m as PricingRequest);
      post(m);
    };
    const client = new PricingClient(transport);
    const [a, s] = await Promise.all([client.analyze(legs, analyzeOptions), client.scenario(legs, scenarioOptions)]);
    expect(a).toEqual(analyze(legs, analyzeOptions));
    expect(s).toEqual(scenarioGrid(legs, scenarioOptions));
    expect(sent.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(client.pendingCount).toBe(0);
  });

  it("[PRICING] rejects with the worker's error message", async () => {
    const client = new PricingClient(createInlineTransport());
    await expect(client.analyze(legs, { spot: -1, nowMs: NOW })).rejects.toThrow(/positive finite/);
    await expect(client.request("greeks" as never, { legs, options: analyzeOptions })).rejects.toThrow(/unknown pricing op/);
  });

  it("[PRICING] times out an unanswered request and ignores a late reply", async () => {
    vi.useFakeTimers();
    let deliver: ((data: unknown) => void) | undefined;
    const transport: MessageTransport = {
      onmessage: null,
      postMessage: (m) => {
        const { id } = m as PricingRequest;
        deliver = (data) => transport.onmessage?.({ data });
        const late: PricingResponse = { id, ok: true, result: analyze(legs, analyzeOptions) };
        setTimeout(() => deliver?.(late), 500);
      },
    };
    const client = new PricingClient(transport, { timeoutMs: 100 });
    const promise = client.analyze(legs, analyzeOptions);
    expect(client.pendingCount).toBe(1);
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow('pricing "analyze" timed out after 100 ms');
    expect(client.pendingCount).toBe(0);
    vi.advanceTimersByTime(500); // the late reply must not throw or resurrect anything
    expect(client.pendingCount).toBe(0);
  });

  it("[PRICING] ignores replies that are malformed or carry an unknown id", async () => {
    const transport: MessageTransport = { onmessage: null, postMessage: () => undefined };
    const client = new PricingClient(transport, { timeoutMs: 50 });
    vi.useFakeTimers();
    const promise = client.analyze(legs, analyzeOptions);
    transport.onmessage?.({ data: "nope" });
    transport.onmessage?.({ data: null });
    transport.onmessage?.({ data: { id: "p1" } });
    transport.onmessage?.({ data: { id: "zz", ok: true, result: 1 } });
    transport.onmessage?.({ data: { id: 9, ok: true, result: 1 } });
    expect(client.pendingCount).toBe(1);
    vi.advanceTimersByTime(50);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("[PRICING] dispose rejects pending requests and detaches from the transport", async () => {
    const transport: MessageTransport = { onmessage: null, postMessage: () => undefined };
    const client = new PricingClient(transport);
    const promise = client.analyze(legs, analyzeOptions);
    expect(transport.onmessage).not.toBeNull();
    client.dispose();
    await expect(promise).rejects.toThrow("pricing client disposed");
    expect(client.pendingCount).toBe(0);
    expect(transport.onmessage).toBeNull();
  });

  it("[PRICING] a transport that throws on postMessage rejects the request", async () => {
    const throwing: MessageTransport = {
      onmessage: null,
      postMessage: () => {
        throw new Error("worker terminated");
      },
    };
    const client = new PricingClient(throwing);
    await expect(client.analyze(legs, analyzeOptions)).rejects.toThrow("worker terminated");
    const throwingValue: MessageTransport = {
      onmessage: null,
      postMessage: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "closed";
      },
    };
    await expect(new PricingClient(throwingValue).analyze(legs, analyzeOptions)).rejects.toThrow("pricing transport failed");
    expect(client.pendingCount).toBe(0);
  });
});

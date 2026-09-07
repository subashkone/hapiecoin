/**
 * Worker-side request handler. Pure: no `Worker` or `self` global is touched at import time, so the same code
 * runs inside a Web Worker (`attachPricingWorker(self)`), on the main thread through an inline transport, or in
 * a Node test.
 */

import { analyze, scenarioGrid } from "../strategy.js";
import type { AnalyzePayload, MessageTransport, PricingResponse, RequestId, ScenarioPayload } from "./protocol.js";

export type PricingWorkerHandler = (message: unknown) => PricingResponse;

interface RequestLike {
  id: RequestId;
  op: string;
  payload: unknown;
}

function isRequestLike(message: unknown): message is RequestLike {
  if (typeof message !== "object" || message === null) return false;
  const m = message as Record<string, unknown>;
  return (typeof m["id"] === "string" || typeof m["id"] === "number") && typeof m["op"] === "string" && "payload" in m;
}

/** Builds the `(message) => response` function; feed it `event.data` from `onmessage`. */
export function createPricingWorkerHandler(): PricingWorkerHandler {
  return (message) => {
    if (!isRequestLike(message)) return { id: null, ok: false, error: "malformed pricing request" };
    const { id, op, payload } = message;
    try {
      if (op === "analyze") {
        const { legs, options } = payload as AnalyzePayload;
        return { id, ok: true, result: analyze(legs, options) };
      }
      if (op === "scenario") {
        const { legs, options } = payload as ScenarioPayload;
        return { id, ok: true, result: scenarioGrid(legs, options) };
      }
      return { id, ok: false, error: `unknown pricing op "${op}"` };
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : "pricing request failed" };
    }
  };
}

/** Wires a handler onto a worker scope (`self` inside the worker) or any transport; returns the handler. */
export function attachPricingWorker(scope: MessageTransport): PricingWorkerHandler {
  const handler = createPricingWorkerHandler();
  scope.onmessage = (event) => {
    scope.postMessage(handler(event.data));
  };
  return handler;
}

/**
 * A transport pair with no worker: requests posted on the returned transport are answered by the handler on
 * the next microtask. Useful for tests, server-side rendering and environments without `Worker`.
 */
export function createInlineTransport(): MessageTransport {
  const handler = createPricingWorkerHandler();
  const transport: MessageTransport = {
    onmessage: null,
    postMessage(message) {
      const response = handler(message);
      queueMicrotask(() => {
        transport.onmessage?.({ data: response });
      });
    },
  };
  return transport;
}

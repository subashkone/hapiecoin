/**
 * UI-side client: wraps any `{ postMessage, onmessage }` transport (a `Worker`, a `MessagePort`, or the inline
 * transport) with request ids, per-request timeouts and promise results.
 */

import type { AnalyzeOptions, AnalyzeResult, ScenarioGrid, ScenarioOptions } from "../strategy.js";
import type { Leg } from "../types.js";
import type { MessageTransport, PricingOp, PricingRequest, PricingResponse } from "./protocol.js";

export interface PricingClientOptions {
  /** Reject a request that has not been answered within this many milliseconds (default 5000). */
  timeoutMs?: number | undefined;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isResponse(data: unknown): data is PricingResponse {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (typeof d["id"] === "string" || typeof d["id"] === "number") && typeof d["ok"] === "boolean";
}

export class PricingClient {
  readonly #transport: MessageTransport;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, Pending>();
  #seq = 0;

  constructor(transport: MessageTransport, options: PricingClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? 5000;
    transport.onmessage = (event) => {
      this.#receive(event.data);
    };
  }

  /** Requests still waiting for a response. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  analyze(legs: Leg[], options: AnalyzeOptions): Promise<AnalyzeResult> {
    return this.request<AnalyzeResult>("analyze", { legs, options });
  }

  scenario(legs: Leg[], options: ScenarioOptions): Promise<ScenarioGrid> {
    return this.request<ScenarioGrid>("scenario", { legs, options });
  }

  /** Low-level request; `payload` must match the op's payload type. */
  request<T>(op: PricingOp, payload: PricingRequest["payload"]): Promise<T> {
    const id = `p${++this.#seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`pricing "${op}" timed out after ${this.#timeoutMs} ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      const request: PricingRequest = { id, op, payload };
      try {
        this.#transport.postMessage(request);
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error("pricing transport failed"));
      }
    });
  }

  /** Rejects every pending request and detaches from the transport. */
  dispose(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("pricing client disposed"));
    }
    this.#pending.clear();
    this.#transport.onmessage = null;
  }

  #receive(data: unknown): void {
    if (!isResponse(data)) return;
    const pending = this.#pending.get(String(data.id));
    if (pending === undefined) return;
    this.#pending.delete(String(data.id));
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data.result);
    else pending.reject(new Error(data.error));
  }
}

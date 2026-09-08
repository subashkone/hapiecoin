"use client";
// One pricing client per browser tab: a Web Worker in the browser, the inline transport where `Worker` does
// not exist (tests, server render). `useAnalysis` batches requests per animation frame so a burst of ticks
// produces one engine call (frontend rule: batch per frame, no layout thrash).
import { type AnalyzeOptions, type AnalyzeResult, type Leg, type MessageTransport, PricingClient, createInlineTransport } from "@hapiecoin/pricing";
import { useEffect, useRef, useState } from "react";

let client: PricingClient | null = null;

export function getPricingClient(): PricingClient {
  if (client) return client;
  if (typeof Worker !== "undefined" && typeof window !== "undefined") {
    try {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      // Adapt the DOM Worker to the engine's minimal transport shape.
      const transport: MessageTransport = { postMessage: (m) => worker.postMessage(m), onmessage: null };
      worker.onmessage = (ev: MessageEvent<unknown>) => transport.onmessage?.({ data: ev.data });
      client = new PricingClient(transport, { timeoutMs: 8000 });
      return client;
    } catch {
      // fall through to the inline transport
    }
  }
  client = new PricingClient(createInlineTransport(), { timeoutMs: 8000 });
  return client;
}

/** Test hook: replace the shared client (e.g. with an inline transport) and reset it afterwards. */
export function setPricingClientForTests(next: PricingClient | null): void {
  client = next;
}

export interface AnalysisState {
  result: AnalyzeResult | null;
  error: string | null;
  /** True while a request is in flight and no result has arrived yet. */
  pending: boolean;
}

const EMPTY: AnalysisState = { result: null, error: null, pending: false };

/**
 * Analyse `legs` at `spot` with the given options; re-runs at most once per animation frame when the
 * inputs change and keeps the last good result while a new one is computed. No legs → null result.
 */
export function useAnalysis(legs: readonly Leg[], options: AnalyzeOptions | null): AnalysisState {
  const [state, setState] = useState<AnalysisState>(EMPTY);
  const seq = useRef(0);
  const frame = useRef<number | null>(null);
  const key = legs.length === 0 || !options ? "" : JSON.stringify([legs, options]);
  useEffect(() => {
    if (key === "") {
      setState(EMPTY);
      return;
    }
    const run = () => {
      frame.current = null;
      const id = (seq.current += 1);
      setState((s) => ({ ...s, pending: true }));
      getPricingClient()
        .analyze(legs as Leg[], options as AnalyzeOptions)
        .then((result) => {
          if (id === seq.current) setState({ result, error: null, pending: false });
        })
        .catch((e: unknown) => {
          if (id === seq.current) setState((s) => ({ result: s.result, error: e instanceof Error ? e.message : "pricing failed", pending: false }));
        });
    };
    if (typeof requestAnimationFrame === "function") {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(run);
      return () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }
    run();
    return undefined;
    // `key` captures legs + options by value; the objects themselves are read when the frame runs.
  }, [key]);
  return state;
}

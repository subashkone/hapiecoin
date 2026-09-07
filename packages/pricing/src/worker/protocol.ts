/**
 * Message protocol between the UI thread and the pricing Web Worker. Messages travel by structured clone, so
 * `Infinity` / `NaN` in results survive (they would not through JSON).
 */

import type { AnalyzeOptions, AnalyzeResult, ScenarioGrid, ScenarioOptions } from "../strategy.js";
import type { Leg } from "../types.js";

export type PricingOp = "analyze" | "scenario";
export type RequestId = string | number;

export interface AnalyzePayload {
  legs: Leg[];
  options: AnalyzeOptions;
}

export interface ScenarioPayload {
  legs: Leg[];
  options: ScenarioOptions;
}

export interface PricingRequest {
  id: RequestId;
  op: PricingOp;
  payload: AnalyzePayload | ScenarioPayload;
}

export interface PricingSuccess<T = AnalyzeResult | ScenarioGrid> {
  id: RequestId | null;
  ok: true;
  result: T;
}

export interface PricingFailure {
  id: RequestId | null;
  ok: false;
  error: string;
}

export type PricingResponse<T = AnalyzeResult | ScenarioGrid> = PricingSuccess<T> | PricingFailure;

/** The subset of `Worker` / `DedicatedWorkerGlobalScope` / `MessagePort` the client and handler rely on. */
export interface MessageTransport {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

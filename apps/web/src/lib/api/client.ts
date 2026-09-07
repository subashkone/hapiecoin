// HTTP client for apps/api (/v1/*). Every response body is parsed through a Zod schema from
// @hapiecoin/schema (or src/lib/api/schemas.ts) before it reaches the app; failures become ApiError.
import { ApiError as ApiErrorBody } from "@hapiecoin/schema";
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Origin prefix; empty for same-origin (Next rewrites proxy /v1 to the API). */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Extra headers on every call (server components forward the session cookie). */
  headers?: Record<string, string>;
}

export interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Response schema; omit for 204 / empty responses. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Build the error thrown for a non-2xx response; tolerant of non-JSON bodies. */
export async function parseApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  const parsed = ApiErrorBody.safeParse(body);
  if (parsed.success) {
    return new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.details);
  }
  const fallback = res.status === 401 ? "UNAUTHORIZED" : res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR";
  return new ApiError(res.status, fallback, res.statusText || `Request failed with status ${res.status}`);
}

export function createApiClient(options: ApiClientOptions = {}) {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      cache: "no-store",
    };
    if (body !== undefined) init.body = body;
    if (opts.signal) init.signal = opts.signal;
    const res = await doFetch(base + path, init);
    if (!res.ok) throw await parseApiError(res);
    if (!opts.schema) return undefined as T;
    if (res.status === 204) throw new ApiError(res.status, "EMPTY_RESPONSE", `Expected a body from ${path}`);
    const json: unknown = await res.json();
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(res.status, "INVALID_RESPONSE", `Response from ${path} did not match the schema`, {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  return {
    request,
    get: <T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) =>
      request<T>(path, signal ? { schema, signal } : { schema }),
    post: <T = void>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>(path, schema ? { method: "POST", body, schema } : { method: "POST", body }),
    put: <T = void>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>(path, schema ? { method: "PUT", body, schema } : { method: "PUT", body }),
    patch: <T = void>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>(path, schema ? { method: "PATCH", body, schema } : { method: "PATCH", body }),
    delete: (path: string) => request<void>(path, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Browser client: same-origin `/v1/*` through the Next rewrite. */
export const api: ApiClient = createApiClient();

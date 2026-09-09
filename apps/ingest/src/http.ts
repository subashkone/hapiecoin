/**
 * Small JSON client shared by every adapter: per-attempt timeout, one retry on 429/5xx/transport errors with a
 * short backoff, and Zod validation of the body so a provider's shape change fails loudly in one place.
 */
import type { z } from "zod";

export type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string>; method?: string; body?: string }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface JsonClientOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Total attempts including the first (default 2). */
  maxAttempts?: number;
  backoffMs?: number;
}

export class UpstreamError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
export class UpstreamSchemaError extends Error {
  constructor(
    readonly url: string,
    readonly issues: readonly string[],
  ) {
    super(`Unexpected response from ${url}: ${issues.join("; ")}`);
    this.name = "UpstreamSchemaError";
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number): boolean => status === 429 || status >= 500;

export class JsonClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(options: JsonClientOptions = {}) {
    const f: FetchLike | undefined = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("JsonClient: no fetch implementation available; pass options.fetch");
    this.fetchImpl = f;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.backoffMs = options.backoffMs ?? 500;
  }

  /** GET `url` (+ query) and validate the JSON body with `schema`. */
  get<T extends z.ZodType>(url: string, schema: T, query: Record<string, string | number> = {}, headers: Record<string, string> = {}): Promise<z.infer<T>> {
    const qs = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const full = qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
    return this.request(full, schema, { headers: { accept: "application/json", ...headers } });
  }

  /** POST a JSON `body` to `url` and validate the response with `schema` (Hyperliquid's info endpoint). */
  post<T extends z.ZodType>(url: string, schema: T, body: unknown, headers: Record<string, string> = {}): Promise<z.infer<T>> {
    return this.request(url, schema, { method: "POST", body: JSON.stringify(body), headers: { accept: "application/json", "content-type": "application/json", ...headers } });
  }

  private async request<T extends z.ZodType>(full: string, schema: T, init: { headers: Record<string, string>; method?: string; body?: string }): Promise<z.infer<T>> {
    let lastError: Error = new Error(`request failed: ${full}`);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(full, { signal: ctrl.signal, ...init });
        const text = await res.text();
        if (res.status >= 200 && res.status < 300) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new UpstreamSchemaError(full, ["body is not JSON"]);
          }
          const out = schema.safeParse(parsed);
          if (!out.success) throw new UpstreamSchemaError(full, out.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
          return out.data;
        }
        lastError = new UpstreamError(full, res.status, `${res.status} from ${full}: ${text.slice(0, 160)}`);
        if (!retryable(res.status)) throw lastError;
      } catch (error) {
        if (error instanceof UpstreamSchemaError) throw error;
        if (error instanceof UpstreamError && !retryable(error.status)) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.maxAttempts) await this.sleep(this.backoffMs * attempt);
    }
    throw lastError;
  }
}

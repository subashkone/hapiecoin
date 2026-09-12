/**
 * The retrying JSON GET every venue REST client is built on: injectable fetch and sleep, a per-attempt timeout,
 * retries on 429 / 5xx / transport failures honouring `Retry-After`, exponential backoff, and JSON decoding.
 * Venue-specific error envelopes and payload schemas sit above it (delta/rest.ts, deribit/rest.ts).
 */

export type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface JsonHttpErrors {
  http(opts: { status: number; url: string; bodySnippet: string; retryable: boolean; attempts: number }): Error;
  schema(source: string, issues: readonly string[]): Error;
}

export interface JsonHttpOptions {
  baseUrl: string;
  /** Injectable fetch (tests pass a fake; defaults to globalThis.fetch). */
  fetch?: FetchLike | undefined;
  /** Injectable sleep for backoff (tests pass a recorder). */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Total attempts per request including the first (default 3). */
  maxAttempts?: number | undefined;
  /** First backoff delay; doubles per retry (default 250 ms). */
  backoffBaseMs?: number | undefined;
  /** Per-attempt timeout (default 5000 ms). */
  timeoutMs?: number | undefined;
  errors: JsonHttpErrors;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_TIMEOUT_MS = 5000;
const SNIPPET_LENGTH = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export class JsonHttp {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly errors: JsonHttpErrors;

  constructor(options: JsonHttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    const fetchImpl: FetchLike | undefined = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("JsonHttp: no fetch implementation available; pass options.fetch");
    this.fetchImpl = fetchImpl;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.errors = options.errors;
  }

  buildUrl(path: string, query: Record<string, string>): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  /** GET and decode the body as JSON; the caller checks the venue's error envelope and validates the shape. */
  async getJson(path: string, query: Record<string, string>): Promise<{ url: string; json: unknown }> {
    const url = this.buildUrl(path, query);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const outcome = await this.attemptOnce(url);
      if (outcome.kind === "response" && !(outcome.status === 429 || outcome.status >= 500)) {
        if (outcome.status < 200 || outcome.status >= 300) {
          throw this.errors.http({ status: outcome.status, url, bodySnippet: snippet(outcome.text), retryable: false, attempts: attempt });
        }
        let json: unknown;
        try {
          json = JSON.parse(outcome.text);
        } catch {
          throw this.errors.schema(url, [`body is not JSON: ${snippet(outcome.text)}`]);
        }
        return { url, json };
      }
      if (attempt >= this.maxAttempts) {
        throw this.errors.http({
          status: outcome.kind === "response" ? outcome.status : 0,
          url,
          bodySnippet: snippet(outcome.kind === "response" ? outcome.text : outcome.message),
          retryable: true,
          attempts: attempt,
        });
      }
      const hinted = outcome.kind === "response" ? outcome.retryAfterMs : null;
      await this.sleep(hinted ?? this.backoffBaseMs * 2 ** (attempt - 1));
    }
  }

  private async attemptOnce(
    url: string,
  ): Promise<{ kind: "response"; status: number; text: string; retryAfterMs: number | null } | { kind: "transport"; message: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      const text = await response.text();
      return { kind: "response", status: response.status, text, retryAfterMs: retryAfterMs(response.headers.get("retry-after")) };
    } catch (error) {
      return { kind: "transport", message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

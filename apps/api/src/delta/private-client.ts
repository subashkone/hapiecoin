/**
 * Delta Exchange India *private* REST client, used for exactly one read-only call: verifying a
 * user's API key/secret with `GET /v2/wallet/balances` when credentials are saved (HC-SH-034).
 * It never calls an order endpoint (trading-safety rule 1) and throws if it sees NODE_ENV=test
 * with a real base URL (rule 2) — tests inject `FakeDeltaPrivateClient`.
 *
 * Signing scheme implemented (Delta docs, "Authentication"; verified against the docs' Python sample):
 *   timestamp  = unix seconds as a string
 *   payload    = method + timestamp + path + query + body
 *                (query includes its leading "?" when present, body is the raw JSON string or "")
 *   signature  = hex(HMAC_SHA256(api_secret, payload))
 *   headers    = { "api-key": <key>, "timestamp": <timestamp>, "signature": <signature>,
 *                  "User-Agent": "hapiecoin-api", "Content-Type": "application/json" }
 * Delta rejects signatures whose timestamp is older than 5 s, so the clock is injectable but must be real in production.
 */
import { signDeltaRequest } from "@hapiecoin/venues";
export { signDeltaRequest };

export type DeltaCredentialErrorCode =
  | "invalid_api_key"
  | "ip_not_whitelisted_for_api_key"
  | "signature_expired"
  | "unauthorized"
  | "delta_unavailable";

export type VerifyCredentialsResult =
  { ok: true; balances: unknown } | { ok: false; code: DeltaCredentialErrorCode; message: string };

export interface DeltaPrivateClient {
  /** One read-only call with the given credentials. Never throws for a credential problem; returns `{ ok: false, code }`. */
  verifyCredentials(creds: { apiKey: string; apiSecret: string }): Promise<VerifyCredentialsResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface DeltaPrivateClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** Unix seconds (default: Date.now()/1000). */
  now?: () => number;
  /** Per-call timeout (trading-safety rule 4: default 5 s). */
  timeoutMs?: number;
  nodeEnv?: string;
}

const KNOWN_CODES = new Set<DeltaCredentialErrorCode>([
  "invalid_api_key",
  "ip_not_whitelisted_for_api_key",
  "signature_expired",
  "unauthorized",
]);

export class DeltaPrivateClientImpl implements DeltaPrivateClient {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(opts: DeltaPrivateClientOptions) {
    if ((opts.nodeEnv ?? process.env["NODE_ENV"]) === "test" && !opts.fetch) {
      throw new Error("trading safety: the live Delta private client must not be used when NODE_ENV=test");
    }
    this.baseUrl = opts.baseUrl;
    this.fetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async verifyCredentials(creds: { apiKey: string; apiSecret: string }): Promise<VerifyCredentialsResult> {
    const req = signDeltaRequest({
      baseUrl: this.baseUrl,
      method: "GET",
      path: "/v2/wallet/balances",
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      timestamp: this.now(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(req.url, {
        method: "GET",
        headers: req.headers,
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed = safeJson(text);
      if (res.status >= 200 && res.status < 300 && parsed?.["success"] === true) {
        return { ok: true, balances: parsed["result"] ?? null };
      }
      const err = parsed?.["error"];
      const rawCode =
        typeof err === "object" && err !== null ? (err as Record<string, unknown>)["code"] : undefined;
      if (typeof rawCode === "string" && KNOWN_CODES.has(rawCode as DeltaCredentialErrorCode)) {
        return {
          ok: false,
          code: rawCode as DeltaCredentialErrorCode,
          message: describe(rawCode as DeltaCredentialErrorCode),
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "unauthorized", message: describe("unauthorized") };
      }
      return { ok: false, code: "delta_unavailable", message: `Delta answered HTTP ${res.status}` };
    } catch (e) {
      const reason = e instanceof Error && e.name === "AbortError" ? "timed out" : "network error";
      return { ok: false, code: "delta_unavailable", message: `Could not reach Delta Exchange (${reason})` };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function describe(code: DeltaCredentialErrorCode): string {
  switch (code) {
    case "invalid_api_key":
      return "Delta Exchange rejected the API key. Check the key and secret and try again.";
    case "ip_not_whitelisted_for_api_key":
      return "This API key is not whitelisted for the HapieCoin server IP. Add the whitelisted IP at Delta Exchange and retry.";
    case "signature_expired":
      return "Delta Exchange rejected the request signature as expired. Check the server clock and retry.";
    case "unauthorized":
      return "Delta Exchange refused the credentials.";
    case "delta_unavailable":
      return "Delta Exchange is not reachable right now.";
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Test double: outcomes keyed by API key; unknown keys are `invalid_api_key`. Records every call. */
export class FakeDeltaPrivateClient implements DeltaPrivateClient {
  readonly calls: { apiKey: string }[] = [];
  private readonly outcomes = new Map<string, VerifyCredentialsResult>();

  accept(apiKey: string, balances: unknown = [{ asset_symbol: "USD", balance: "1000.00" }]): this {
    this.outcomes.set(apiKey, { ok: true, balances });
    return this;
  }

  reject(apiKey: string, code: DeltaCredentialErrorCode): this {
    this.outcomes.set(apiKey, { ok: false, code, message: describe(code) });
    return this;
  }

  verifyCredentials(creds: { apiKey: string; apiSecret: string }): Promise<VerifyCredentialsResult> {
    this.calls.push({ apiKey: creds.apiKey });
    return Promise.resolve(
      this.outcomes.get(creds.apiKey) ?? {
        ok: false,
        code: "invalid_api_key",
        message: describe("invalid_api_key"),
      },
    );
  }
}

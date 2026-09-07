/** Typed errors for venue adapters. Never include secrets in messages (trading-safety rule 3). */

export class DeltaHttpError extends Error {
  /** HTTP status; 0 when the request never produced a response (network failure, timeout). */
  readonly status: number;
  readonly url: string;
  /** First 200 characters of the response body (or the transport error message). */
  readonly bodySnippet: string;
  /** Whether the client considered the failure retryable (429 / 5xx / transport). */
  readonly retryable: boolean;
  /** Attempts made before giving up. */
  readonly attempts: number;

  constructor(opts: { status: number; url: string; bodySnippet: string; retryable: boolean; attempts: number }) {
    super(`Delta HTTP ${opts.status} for ${opts.url} after ${opts.attempts} attempt(s): ${opts.bodySnippet}`);
    this.name = "DeltaHttpError";
    this.status = opts.status;
    this.url = opts.url;
    this.bodySnippet = opts.bodySnippet;
    this.retryable = opts.retryable;
    this.attempts = opts.attempts;
  }
}

export class DeltaSchemaError extends Error {
  /** Where the payload came from (URL or WS channel). */
  readonly source: string;
  /** Human-readable Zod issues ("result[3].mark_price: expected string"). */
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`Delta payload from ${source} failed validation: ${issues.slice(0, 5).join("; ")}`);
    this.name = "DeltaSchemaError";
    this.source = source;
    this.issues = issues;
  }
}

/** Delta answered with HTTP 2xx but `success: false`. */
export class DeltaApiError extends Error {
  readonly url: string;
  readonly code: string;
  readonly context: unknown;

  constructor(url: string, code: string, context: unknown) {
    super(`Delta API error ${code} for ${url}`);
    this.name = "DeltaApiError";
    this.url = url;
    this.code = code;
    this.context = context;
  }
}

export class InvalidSymbolError extends Error {
  readonly symbol: string;
  constructor(symbol: string, reason: string) {
    super(`Invalid Delta symbol ${JSON.stringify(symbol)}: ${reason}`);
    this.name = "InvalidSymbolError";
    this.symbol = symbol;
  }
}

export class InvalidExpiryError extends Error {
  readonly input: string;
  constructor(input: string, reason: string) {
    super(`Invalid expiry ${JSON.stringify(input)}: ${reason}`);
    this.name = "InvalidExpiryError";
    this.input = input;
  }
}

/** `buildChain` was asked for an underlying/expiry that has no option instruments. */
export class UnknownExpiryError extends Error {
  readonly underlying: string;
  readonly expiry: string;
  constructor(underlying: string, expiry: string) {
    super(`No option instruments for ${underlying} expiry ${expiry}`);
    this.name = "UnknownExpiryError";
    this.underlying = underlying;
    this.expiry = expiry;
  }
}

/** The WebSocket went quiet for longer than the heartbeat window; the client reconnects. */
export class StaleConnectionError extends Error {
  readonly silentMs: number;
  constructor(silentMs: number) {
    super(`No message from venue for ${silentMs} ms; reconnecting`);
    this.name = "StaleConnectionError";
    this.silentMs = silentMs;
  }
}

/** The venue sent an application-level error frame over the WebSocket. */
export class VenueWsError extends Error {
  readonly payload: unknown;
  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "VenueWsError";
    this.payload = payload;
  }
}

/** A fetch stand-in routed by URL path: tests register JSON bodies (or raw responses) per path and inspect the calls. */
import type { FetchLike } from "../http.js";

export interface FakeResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}
export interface FakeInit {
  method: string;
  body: string | undefined;
}
type Handler = FakeResponse | ((url: URL, call: number, init: FakeInit) => FakeResponse | Promise<FakeResponse>);

export class FakeFetch {
  readonly calls: { url: string; headers: Record<string, string>; method: string; body: string | undefined }[] = [];
  private readonly routes = new Map<string, Handler>();
  private readonly counts = new Map<string, number>();

  /** Register by pathname (e.g. "/fapi/v1/fundingRate"); the last registration wins. */
  on(path: string, handler: Handler): this {
    this.routes.set(path, handler);
    return this;
  }

  get fetch(): FetchLike {
    return async (input, init) => {
      const url = new URL(input);
      const finit: FakeInit = { method: init.method ?? "GET", body: init.body };
      this.calls.push({ url: input, headers: init.headers, ...finit });
      const handler = this.routes.get(url.pathname);
      if (!handler) return { status: 404, headers: { get: () => null }, text: () => Promise.resolve(`no route for ${url.pathname}`) };
      const n = (this.counts.get(url.pathname) ?? 0) + 1;
      this.counts.set(url.pathname, n);
      const r = typeof handler === "function" ? await handler(url, n, finit) : handler;
      const text = r.text ?? JSON.stringify(r.body ?? null);
      return { status: r.status ?? 200, headers: { get: (name) => r.headers?.[name.toLowerCase()] ?? null }, text: () => Promise.resolve(text) };
    };
  }

  callsTo(path: string): number {
    return this.counts.get(path) ?? 0;
  }
}

/** A fetch that always throws (transport failure). */
export const failingFetch: FetchLike = () => Promise.reject(new Error("ECONNRESET"));

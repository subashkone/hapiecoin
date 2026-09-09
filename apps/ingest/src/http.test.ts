import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonClient, UpstreamError, UpstreamSchemaError } from "./http.js";
import { FakeFetch, failingFetch } from "./test-support/fake-fetch.js";

const Body = z.object({ ok: z.boolean() });
const noSleep = () => Promise.resolve();

describe("[INGEST] JsonClient", () => {
  it("builds the query string, sends accept + extra headers and validates the body", async () => {
    const f = new FakeFetch().on("/x", { body: { ok: true } });
    const c = new JsonClient({ fetch: f.fetch, sleep: noSleep });
    expect(await c.get("https://h/x", Body, { a: 1, b: "c d" }, { "x-key": "k" })).toEqual({ ok: true });
    expect(f.calls[0]?.url).toBe("https://h/x?a=1&b=c%20d");
    expect(f.calls[0]?.headers).toEqual({ accept: "application/json", "x-key": "k" });
    await c.get("https://h/x?z=1", Body, { a: 1 });
    expect(f.calls[1]?.url).toBe("https://h/x?z=1&a=1");
  });
  it("posts JSON bodies with the content type and validates the reply", async () => {
    const f = new FakeFetch().on("/info", (_url, _n, init) => ({ body: { ok: init.body === JSON.stringify({ type: "x" }) && init.method === "POST" } }));
    const c = new JsonClient({ fetch: f.fetch, sleep: noSleep });
    expect(await c.post("https://h/info", Body, { type: "x" })).toEqual({ ok: true });
    expect(f.calls[0]?.headers["content-type"]).toBe("application/json");
  });
  it("rejects non-JSON and schema mismatches without retrying", async () => {
    const f = new FakeFetch().on("/t", { text: "<html>" }).on("/s", { body: { ok: "yes" } });
    const c = new JsonClient({ fetch: f.fetch, sleep: noSleep });
    await expect(c.get("https://h/t", Body)).rejects.toBeInstanceOf(UpstreamSchemaError);
    await expect(c.get("https://h/s", Body)).rejects.toThrow(/ok: /);
    await expect(c.get("https://h/s", z.array(Body))).rejects.toThrow(/\(root\): /);
    expect(f.callsTo("/t")).toBe(1);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a provider SDK may reject with a string
    const weird = new JsonClient({ fetch: () => Promise.reject("weird"), sleep: noSleep, maxAttempts: 1 });
    await expect(weird.get("https://h/x", Body)).rejects.toThrow("weird");
  });
  it("retries 429 and 5xx and transport failures once, then gives up; 4xx is final", async () => {
    const sleeps: number[] = [];
    const f = new FakeFetch()
      .on("/flaky", (_u, n) => (n === 1 ? { status: 503, text: "down" } : { body: { ok: true } }))
      .on("/dead", { status: 500, text: "boom" })
      .on("/gone", { status: 404, text: "nope" })
      .on("/limited", (_u, n) => (n === 1 ? { status: 429, text: "slow down" } : { body: { ok: true } }));
    const c = new JsonClient({ fetch: f.fetch, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, backoffMs: 10 });
    expect(await c.get("https://h/flaky", Body)).toEqual({ ok: true });
    expect(await c.get("https://h/limited", Body)).toEqual({ ok: true });
    expect(sleeps).toEqual([10, 10]);
    await expect(c.get("https://h/dead", Body)).rejects.toBeInstanceOf(UpstreamError);
    expect(f.callsTo("/dead")).toBe(2);
    await expect(c.get("https://h/gone", Body)).rejects.toMatchObject({ status: 404 });
    expect(f.callsTo("/gone")).toBe(1);
    const t = new JsonClient({ fetch: failingFetch, sleep: noSleep, maxAttempts: 3 });
    await expect(t.get("https://h/x", Body)).rejects.toThrow("ECONNRESET");
  });
  it("uses the global fetch by default and refuses to start without one", () => {
    const original = globalThis.fetch;
    expect(() => new JsonClient()).not.toThrow();
    // @ts-expect-error simulate a runtime without fetch
    globalThis.fetch = undefined;
    try {
      expect(() => new JsonClient()).toThrow(/no fetch/);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("aborts a hung request at the timeout", async () => {
    const hung: typeof failingFetch = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const c = new JsonClient({ fetch: hung, sleep: noSleep, timeoutMs: 5, maxAttempts: 1 });
    await expect(c.get("https://h/x", Body)).rejects.toThrow("aborted");
  });
});

// /v1/analytics/{dataset} (ADR-038): public reads of the ingest snapshots with cache and as-of headers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import { MemoryAnalyticsReader, RedisAnalyticsReader } from "../analytics.js";
import { type TestApp, createTestApp } from "../test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const fng: AnalyticsSnapshot = { dataset: "fear-greed", key: "fear-greed:-", source: "alternative.me", asOf: 1_788_900_000_000, ttlMs: 3_600_000, stale: false, data: { points: [{ t: 1_788_800_000_000, v: 42 }], latest: { value: 42, label: "Fear", at: 1_788_800_000_000 } } };
const funding: AnalyticsSnapshot = { dataset: "funding", key: "funding:BTC", source: "Binance · OKX", asOf: 1_788_900_000_000, ttlMs: 60_000, stale: true, data: { symbol: "BTC", venues: [{ venue: "binance", rate: 0.0001, predicted: null, nextFundingAt: 1_788_912_000_000, apr: 0.1095, oiUsd: 5e9 }], history: [{ venue: "binance", points: [{ t: 1_788_800_000_000, v: 0.0001 }] }], oiWeighted: [{ t: 1_788_800_000_000, v: 0.0001 }] } };

describe("GET /v1/analytics/{dataset}", () => {
  it("serves a seeded snapshot without a session, with cache and as-of headers", async () => {
    t.analytics.seed(fng);
    const res = await t.request("/v1/analytics/fear-greed");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-as-of")).toBe(new Date(1_788_900_000_000).toISOString());
    const body = (await res.json()) as AnalyticsSnapshot;
    expect(body.dataset).toBe("fear-greed");
    expect(body.data).toEqual(fng.data);
  });

  it("requires a symbol for per-symbol datasets and upper-cases it", async () => {
    t.analytics.seed(funding);
    expect((await t.request("/v1/analytics/funding")).status).toBe(400);
    expect((await t.request("/v1/analytics/funding?symbol=b")).status).toBe(400);
    const res = await t.request("/v1/analytics/funding?symbol=btc");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=15");
    expect(((await res.json()) as AnalyticsSnapshot).stale).toBe(true);
  });

  it("answers 503 UNAVAILABLE before the ingest service has written the key, and 400 for an unknown dataset", async () => {
    const res = await t.request("/v1/analytics/markets");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("UNAVAILABLE");
    expect((await t.request("/v1/analytics/nope")).status).toBe(400);
  });
});

describe("analytics readers", () => {
  it("the Redis reader re-validates JSON and ignores garbage or unknown shapes", async () => {
    const map = new Map<string, string>([
      ["hapiecoin:an:fear-greed:-", JSON.stringify(fng)],
      ["hapiecoin:an:bad:-", "{not json"],
      ["hapiecoin:an:wrong:-", JSON.stringify({ dataset: "fear-greed", nope: 1 })],
    ]);
    const reader = new RedisAnalyticsReader({ get: (k) => Promise.resolve(map.get(k) ?? null) });
    const got = await reader.get("fear-greed:-");
    if (!got || got.dataset !== "fear-greed") throw new Error("expected the fear-greed snapshot");
    expect(got.data.latest.value).toBe(42);
    expect(await reader.get("bad:-")).toBeNull();
    expect(await reader.get("wrong:-")).toBeNull();
    expect(await reader.get("missing:-")).toBeNull();
    const mem = new MemoryAnalyticsReader();
    mem.seed(fng);
    expect(await mem.get("fear-greed:-")).toEqual(fng);
    mem.clear();
    expect(await mem.get("fear-greed:-")).toBeNull();
  });
});

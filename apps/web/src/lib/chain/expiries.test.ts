import { describe, expect, it, vi } from "vitest";
import { discoverExpiries, nearestExpiry } from "./expiries";

const defaults = "2026-09-11,2026-09-18,2026-09-25";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("HC-WS-107 expiry discovery", () => {
  it("prefers the gateway's /healthz list, filtered to today or later and sorted", async () => {
    const fetch = vi.fn(() => json({ ok: true, feed: { ready: true, expiries: { BTC: ["2026-10-30", "2026-09-05", "2026-09-25", "bad"] } } }));
    const r = await discoverExpiries("BTC", {
      gatewayWsUrl: "ws://gw:3002",
      defaultsCsv: defaults,
      fetch: fetch,
      today: "2026-09-07",
    });
    expect(r).toEqual({ expiries: ["2026-09-25", "2026-10-30"], source: "gateway" });
    expect(fetch).toHaveBeenCalledWith("http://gw:3002/healthz", { cache: "no-store" });
  });

  it("falls back to the env list when the gateway list is empty", async () => {
    const empty = vi.fn(() => json({ ok: true, expiries: { ETH: [] } }));
    const r = await discoverExpiries("ETH", { gatewayWsUrl: "ws://x", defaultsCsv: defaults, fetch: empty, today: "2026-09-12" });
    expect(r).toEqual({ expiries: ["2026-09-18", "2026-09-25"], source: "default" });
  });

  it("falls back when the gateway errors, is unreachable, or returns garbage", async () => {
    const bad = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    const r1 = await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: defaults, fetch: bad, today: "2026-01-01" });
    expect(r1.source).toBe("default");
    const down = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const r2 = await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: defaults, fetch: down, today: "2026-01-01" });
    expect(r2.expiries).toHaveLength(3);
    const garbage = vi.fn(() => json({ expiries: { BTC: ["nope"] } }));
    const r3 = await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: defaults, fetch: garbage, today: "2026-01-01" });
    expect(r3.source).toBe("default");
  });

  it("HC-SH-124 another venue reads its own list from feed.venues, keeps its settlement hour and has no env fallback (ADR-069)", async () => {
    const health = { ok: true, feed: { ready: true, expiries: { BTC: ["2026-09-25", "2026-09-11"] }, venues: { delta_india: { expiries: { BTC: ["2026-09-25", "2026-09-11"] } }, deribit: { expiries: { BTC: ["2026-09-12", "2026-09-11"] } } } } };
    const fetch = vi.fn(() => json(health));
    // 11 Sep 09:00 UTC: Deribit's 11 Sep expiry settled at 08:00, Delta's stays listed until 12:00
    const nowMs = Date.UTC(2026, 8, 11, 9);
    expect(await discoverExpiries("BTC", { gatewayWsUrl: "ws://gw", defaultsCsv: defaults, fetch, today: "2026-09-11", nowMs, venue: "deribit" })).toEqual({ expiries: ["2026-09-12"], source: "gateway" });
    expect(await discoverExpiries("BTC", { gatewayWsUrl: "ws://gw", defaultsCsv: defaults, fetch, today: "2026-09-11", nowMs, venue: "delta_india" })).toEqual({ expiries: ["2026-09-11", "2026-09-25"], source: "gateway" });
    const none = vi.fn(() => json({ ok: true, feed: { ready: true, expiries: { BTC: ["2026-09-25"] } } }));
    expect(await discoverExpiries("BTC", { gatewayWsUrl: "ws://gw", defaultsCsv: defaults, fetch: none, today: "2026-09-11", venue: "deribit" })).toEqual({ expiries: [], source: "default" });
  });

  it("works without any fetch implementation and defaults today to now", async () => {
    const r = await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: "2099-01-01", fetch: undefined as unknown as typeof globalThis.fetch });
    expect(r.expiries).toEqual(["2099-01-01"]);
  });

  it("nearestExpiry returns the first or null", () => {
    expect(nearestExpiry(["2026-09-11", "2026-09-18"])).toBe("2026-09-11");
    expect(nearestExpiry([])).toBeNull();
  });

  it("drops an expiry once its settlement instant has passed (12:00 UTC BTC, 16:00 UTC XAUT)", async () => {
    const empty = (() => Promise.resolve(new Response("{}", { status: 500 }))) as unknown as typeof fetch;
    const csv = "2026-09-07,2026-09-11";
    const at = (h: number) => Date.UTC(2026, 8, 7, h);
    expect((await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: csv, fetch: empty, today: "2026-09-07", nowMs: at(11) })).expiries).toEqual(["2026-09-07", "2026-09-11"]);
    expect((await discoverExpiries("BTC", { gatewayWsUrl: "ws://x", defaultsCsv: csv, fetch: empty, today: "2026-09-07", nowMs: at(13) })).expiries).toEqual(["2026-09-11"]);
    expect((await discoverExpiries("XAUT", { gatewayWsUrl: "ws://x", defaultsCsv: csv, fetch: empty, today: "2026-09-07", nowMs: at(13) })).expiries).toEqual(["2026-09-07", "2026-09-11"]);
  });
});

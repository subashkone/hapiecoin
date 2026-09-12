// HC-SH-125 (ADR-070): the API's venue clients, served from the recorded venue fixtures through an injected fetch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type FetchLike, VenueCapabilityError } from "@hapiecoin/venues";
import { loadConfig } from "./config.js";
import { createVenueClients } from "./venues.js";

const BASE = { NODE_ENV: "test", BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef", CREDENTIALS_ENC_KEY: Buffer.alloc(32, 1).toString("base64") };
const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../spec/fixtures/${name}`, import.meta.url)), "utf-8"));
const none = { jsonrpc: "2.0", result: [] };
const requested: string[] = [];

/** Delta India and Deribit public REST, answered from the fixtures; anything else is a 404. */
const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  requested.push(url.origin + url.pathname);
  const btc = (url.searchParams.get("currency") ?? url.searchParams.get("underlying_asset_symbols") ?? "BTC").toUpperCase() === "BTC";
  let body: unknown;
  let status = 200;
  if (url.pathname.endsWith("/v2/products")) body = fixture("delta-products.json");
  else if (url.pathname.endsWith("/v2/tickers")) body = btc ? fixture("delta-tickers.json") : { success: true, result: [] };
  else if (url.pathname.endsWith("get_instruments")) body = btc && url.searchParams.get("kind") !== "future" ? fixture("deribit-instruments-btc.json") : none;
  else if (url.pathname.endsWith("get_book_summary_by_currency")) body = btc ? fixture("deribit-book-summary-btc.json") : none;
  else {
    status = 404;
    body = { error: "not here" };
  }
  return Promise.resolve({ status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
};

describe("HC-SH-125 [API] venue clients (ADR-070)", () => {
  it("builds a trading client per trading venue, a public REST client per API_VENUES entry, and refuses the rest", () => {
    const config = loadConfig({ ...BASE, API_VENUES: "delta_india,deribit" }, { warn: () => undefined });
    const clients = createVenueClients(config, { fetch: fetchFixtures });
    expect(clients.venues).toEqual(["delta_india", "deribit"]);
    expect(clients.tradingFor("delta_india")).toBeDefined();
    expect(() => clients.tradingFor("deribit")).toThrowError(VenueCapabilityError); // data-only: no client exists, so no order can be built
    expect(() => clients.tradingFor("okx")).toThrowError(VenueCapabilityError);
    expect(clients.restFor("delta_india")).not.toBeNull();
    expect(clients.restFor("deribit")).not.toBeNull();
    expect(clients.restFor("okx")).toBeNull();
    expect(clients.sources.map((s) => s.venue)).toEqual(["delta_india", "deribit"]);
  });

  it("the default venue's trading client signs against DELTA_TRADING_REST_URL, not the public base", async () => {
    const config = loadConfig({ ...BASE, DELTA_TRADING_REST_URL: "https://testnet.example.test" }, { warn: () => undefined });
    const clients = createVenueClients(config, { fetch: fetchFixtures });
    requested.length = 0;
    await clients.tradingFor("delta_india").getProduct("C-BTC-80000-250926").catch(() => null); // the fixture fetch answers 404: the host is what matters
    expect(requested.some((u) => u.startsWith("https://testnet.example.test/"))).toBe(true);
    expect(requested.some((u) => u.startsWith("https://api.india.delta.exchange/"))).toBe(false);
  });

  it("the snapshotter sources, the live spot and the rules tick speak each venue's dialect and stamp its id", async () => {
    const config = loadConfig({ ...BASE, API_VENUES: "delta_india,deribit" }, { warn: () => undefined });
    const clients = createVenueClients(config, { fetch: fetchFixtures });
    const [delta, deribit] = clients.sources;
    const deltaProducts = await delta!.products();
    expect(deltaProducts.length).toBeGreaterThan(0);
    expect(deltaProducts.every((p) => p.venue === "delta_india" && p.id.startsWith("delta_india:"))).toBe(true);
    const deribitProducts = await deribit!.products();
    expect(deribitProducts.length).toBe(950);
    expect(deribitProducts.every((p) => p.venue === "deribit" && p.id.startsWith("deribit:"))).toBe(true);
    expect((await deribit!.tickers("BTC")).every((q) => q.instrumentId.startsWith("deribit:"))).toBe(true);
    // the rules tick: marks keyed by the bare venue symbol, the spot from the first ticker that carries one
    const tickDelta = await clients.tick("BTC", "delta_india");
    expect(tickDelta?.spot).toBeGreaterThan(0);
    expect(tickDelta!.marks.size).toBeGreaterThan(0);
    expect([...tickDelta!.marks.keys()].every((k) => !k.includes(":"))).toBe(true);
    const tickDeribit = await clients.tick("BTC", "deribit");
    expect(tickDeribit?.spot).toBeGreaterThan(0);
    expect([...tickDeribit!.marks.keys()].some((k) => k === "BTC-12SEP26-69000-C")).toBe(true);
    expect(await clients.tick("BTC", "okx")).toBeNull();
    expect(await clients.liveSpot("BTC", "delta_india")).toBeGreaterThan(0);
    expect(await clients.liveSpot("BTC", "deribit")).toBeGreaterThan(0);
    expect(await clients.liveSpot("ETH", "deribit")).toBeNull(); // the fixture lists BTC only: no spot
    expect(await clients.liveSpot("BTC", "okx")).toBeNull();
  });

  it("the default configuration reads Delta India only", async () => {
    const clients = createVenueClients(loadConfig(BASE, { warn: () => undefined }), { fetch: fetchFixtures });
    expect(clients.venues).toEqual(["delta_india"]);
    expect(clients.restFor("deribit")).toBeNull();
    expect(await clients.tick("BTC", "deribit")).toBeNull();
    expect(clients.sources).toHaveLength(1);
  });
});

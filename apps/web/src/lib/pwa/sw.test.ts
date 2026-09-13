// HC-SH-135 the service worker's routing and fallbacks (ADR-082). public/sw.js is plain JS with no imports, so the
// test runs it inside a sandbox with a fake worker global and a fake Cache API, then drives the exported seam.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://app.hapiecoin.com";
const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"); // vitest runs from apps/web

interface FakeReq {
  url: string;
  method: string;
  mode?: string | undefined;
}
interface Seam {
  VERSION: string;
  OFFLINE_URL: string;
  STATIC_KEEP: number;
  stylesheetsOf: (html: string) => string[];
  route: (req: FakeReq, origin: string) => "static" | "navigate" | "pass";
  cacheFirst: (req: FakeReq) => Promise<Response>;
  networkFirstNavigation: (req: FakeReq) => Promise<Response>;
}
type Handler = (event: { request: FakeReq; respondWith: (p: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void }) => void;

function load() {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      const keyOf = (r: FakeReq | string) => (typeof r === "string" ? r : r.url);
      return Promise.resolve({
        match: (r: FakeReq | string) => Promise.resolve(store.get(keyOf(r)) ?? store.get(new URL(keyOf(r), ORIGIN).pathname)),
        put: (r: FakeReq | string, res: Response) => {
          store.set(keyOf(r), res);
          return Promise.resolve();
        },
        addAll: (paths: string[]) => {
          for (const p of paths) store.set(p, new Response(`cached ${p}`));
          return Promise.resolve();
        },
        keys: () => Promise.resolve([...store.keys()].map((k) => ({ url: k.startsWith("http") ? k : ORIGIN + k }))),
        delete: (r: FakeReq | string) => Promise.resolve(store.delete(keyOf(r))),
      });
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
  const handlers = new Map<string, Handler>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  } as Record<string, unknown>;
  const OFFLINE_HTML = '<html><head><link rel="preload" href="/_next/static/chunks/x.js"><link rel="stylesheet" href="/_next/static/css/abc.css"><link href="https://fonts.example/f.css" rel="stylesheet"></head><body>offline page</body></html>';
  const fetch = vi.fn<(r: FakeReq | string, init?: unknown) => Promise<Response>>((r) => {
    const url = typeof r === "string" ? r : r.url;
    if (url.endsWith("/offline")) return Promise.resolve(new Response(OFFLINE_HTML, { status: 200, headers: { "Content-Type": "text/html" } }));
    return Promise.reject(new TypeError("Failed to fetch"));
  });
  vm.runInNewContext(source, { self, caches, fetch, URL, Response, Promise, console });
  return { seam: self["__hapiecoinSw"] as Seam, handlers, stores, fetch, self, caches };
}

const req = (path: string, method = "GET", mode?: string): FakeReq => ({ url: path.startsWith("http") ? path : ORIGIN + path, method, mode });
// the fake cache is keyed by request url, so a trim by pathname needs the store keys to carry the origin


describe("HC-SH-135 service worker (ADR-082)", () => {
  let sw: ReturnType<typeof load>;
  beforeEach(() => {
    sw = load();
  });

  it("HC-SH-135 leaves the API, auth, test hooks, other origins and non-GET requests alone; handles hashed assets and navigations only", () => {
    const { route } = sw.seam;
    for (const p of ["/v1/live/positions", "/v1", "/v1/chain/BTC", "/api/auth/session", "/api", "/__test/otp", "/_next/data/x.json", "/_next/image?url=a"]) {
      expect(route(req(p, "GET", "navigate"), ORIGIN), p).toBe("pass");
    }
    expect(route(req("/v1/live/place", "POST"), ORIGIN)).toBe("pass");
    expect(route(req("https://gw.hapiecoin.com/healthz"), ORIGIN)).toBe("pass");
    expect(route(req("/analyse", "GET", "cors"), ORIGIN)).toBe("pass"); // a fetch() of a page, not a navigation
    expect(route(req("/_next/static/chunks/main-abc123.js"), ORIGIN)).toBe("static");
    expect(route(req("/analyse", "GET", "navigate"), ORIGIN)).toBe("navigate");
    expect(route(req("/t/asha", "GET", "navigate"), ORIGIN)).toBe("navigate");
    expect(route(req("/auth", "GET", "navigate"), ORIGIN)).toBe("navigate"); // the sign-in page is a page; the auth API lives under /api/auth
    expect(route(req("/v1ews", "GET", "navigate"), ORIGIN)).toBe("navigate"); // a prefix does not swallow a look-alike route
    expect(route({ url: "not a url", method: "GET" }, ORIGIN)).toBe("pass");
  });

  it("HC-SH-135 install fetches the offline page fresh with the stylesheets it links (icons are not precached) and activate drops older caches", async () => {
    const waits: Promise<unknown>[] = [];
    const ev = { request: req("/"), respondWith: vi.fn(), waitUntil: (p: Promise<unknown>) => waits.push(p) };
    sw.handlers.get("install")!(ev);
    await Promise.all(waits);
    const store = sw.stores.get(sw.seam.VERSION)!;
    expect([...store.keys()]).toEqual(["/offline", "/_next/static/css/abc.css"]); // same-origin stylesheets only, no preloads, no fonts host
    expect(await store.get("/offline")!.clone().text()).toContain("offline page");
    expect(sw.seam.stylesheetsOf("<link rel=\"stylesheet\" href=\"//cdn.example/a.css\">")).toEqual([]);
    expect(sw.self["skipWaiting"]).toHaveBeenCalled();
    sw.stores.set("hapiecoin-pwa-v0", new Map());
    const waits2: Promise<unknown>[] = [];
    sw.handlers.get("activate")!({ ...ev, waitUntil: (p) => waits2.push(p) });
    await Promise.all(waits2);
    expect([...sw.stores.keys()]).toEqual([sw.seam.VERSION]);
    expect((sw.self["clients"] as { claim: () => void }).claim).toHaveBeenCalled();
  });

  it("HC-SH-135 a navigation goes to the network first and falls back to the offline page only when fetch rejects", async () => {
    const page = new Response("<html>live</html>");
    sw.fetch.mockResolvedValueOnce(page);
    let answered: Promise<Response> | undefined;
    const respondWith = (p: Promise<Response>) => {
      answered = p;
    };
    sw.handlers.get("fetch")!({ request: req("/analyse", "GET", "navigate"), respondWith, waitUntil: vi.fn() });
    expect(await answered).toBe(page);
    expect([...(sw.stores.get(sw.seam.VERSION)?.keys() ?? [])]).toEqual([]); // the page was not stored
    // network gone, before install ever ran: a plain 503 text
    sw.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    answered = undefined;
    sw.handlers.get("fetch")!({ request: req("/analytics", "GET", "navigate"), respondWith, waitUntil: vi.fn() });
    const fallback = await answered!;
    expect(fallback.status).toBe(503);
    expect(await fallback.text()).toContain("offline");
    // after install: the precached page
    const waits: Promise<unknown>[] = [];
    sw.handlers.get("install")!({ request: req("/"), respondWith: vi.fn(), waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    sw.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    answered = undefined;
    sw.handlers.get("fetch")!({ request: req("/analytics", "GET", "navigate"), respondWith, waitUntil: vi.fn() });
    expect(await (await answered!).text()).toContain("offline page");
  });

  it("HC-SH-135 the first navigation after a worker start refreshes the offline page and trims the asset cache to the newest entries", async () => {
    const cache = await sw.caches.open(sw.seam.VERSION);
    for (let i = 0; i < sw.seam.STATIC_KEEP + 3; i++) await cache.put(req(`/_next/static/chunks/c${i}.js`), new Response("js"));
    const waits: Promise<unknown>[] = [];
    sw.fetch.mockResolvedValueOnce(new Response("<html>live</html>"));
    sw.handlers.get("fetch")!({ request: req("/analyse", "GET", "navigate"), respondWith: vi.fn(), waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    const store = sw.stores.get(sw.seam.VERSION)!;
    expect(store.has("/offline")).toBe(true);
    const statics = [...store.keys()].filter((k) => k.includes("/_next/static/chunks/"));
    expect(statics).toHaveLength(sw.seam.STATIC_KEEP);
    expect(statics[0]).toContain("/c3.js"); // the three oldest went
    expect(store.has("/_next/static/css/abc.css")).toBe(true); // the offline page keeps its stylesheet whatever the trim
    // a second navigation in the same worker start does not refresh again
    sw.fetch.mockClear();
    sw.fetch.mockResolvedValueOnce(new Response("<html>live</html>"));
    const waits2: Promise<unknown>[] = [];
    sw.handlers.get("fetch")!({ request: req("/analytics", "GET", "navigate"), respondWith: vi.fn(), waitUntil: (p) => waits2.push(p) });
    await Promise.all(waits2);
    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });

  it("HC-SH-135 an immutable asset is fetched once and then served from the cache; a failed or non-immutable fetch is not stored", async () => {
    const asset = req("/_next/static/chunks/app-1a2b3c.js");
    sw.fetch.mockResolvedValueOnce(new Response("js", { status: 200, headers: { "Cache-Control": "public, max-age=31536000, immutable" } }));
    let answered: Promise<Response> | undefined;
    const respondWith = (p: Promise<Response>) => {
      answered = p;
    };
    sw.handlers.get("fetch")!({ request: asset, respondWith, waitUntil: vi.fn() });
    expect(await (await answered!).text()).toBe("js");
    sw.fetch.mockClear();
    answered = undefined;
    sw.handlers.get("fetch")!({ request: asset, respondWith, waitUntil: vi.fn() });
    expect(await (await answered!).text()).toBe("js");
    expect(sw.fetch).not.toHaveBeenCalled();
    const missing = req("/_next/static/chunks/gone.js");
    sw.fetch.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    answered = undefined;
    sw.handlers.get("fetch")!({ request: missing, respondWith, waitUntil: vi.fn() });
    expect((await answered!).status).toBe(404);
    expect(sw.stores.get(sw.seam.VERSION)?.has(missing.url)).toBe(false);
    // a dev chunk (no immutable marker) is answered but never kept, so an edit is never served stale
    const dev = req("/_next/static/chunks/app/page.js");
    sw.fetch.mockResolvedValueOnce(new Response("dev js", { status: 200, headers: { "Cache-Control": "no-store, must-revalidate" } }));
    answered = undefined;
    sw.handlers.get("fetch")!({ request: dev, respondWith, waitUntil: vi.fn() });
    expect(await (await answered!).text()).toBe("dev js");
    expect(sw.stores.get(sw.seam.VERSION)?.has(dev.url)).toBe(false);
    // an API call never reaches respondWith
    const rw = vi.fn();
    sw.handlers.get("fetch")!({ request: req("/v1/chain/BTC", "GET", "cors"), respondWith: rw, waitUntil: vi.fn() });
    expect(rw).not.toHaveBeenCalled();
  });
});

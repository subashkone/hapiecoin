/* HapieCoin service worker (ADR-082; HC-SH-135).
 *
 * Deny by default. The worker answers only two kinds of same-origin GET:
 *   - build assets under /_next/static/ (cache-first, stored only when the server marks them immutable: production
 *     chunks are content-hashed and immutable, dev chunks are not and so are never cached);
 *   - page navigations (network-first; when the network is gone, the precached /offline page).
 * Everything else passes straight through to the network untouched: the API (/v1, /api, which includes the auth
 * API under /api/auth), the test hooks (/__test), the gateway (a different origin, and WebSocket frames never
 * reach a worker), Next's data and image routes, POSTs. Market data, positions, orders and sessions are therefore
 * never served from a cache. No page response is ever stored except /offline: pages carry a per-request CSP nonce
 * and the signed-in trader's data.
 *
 * The offline page is fetched at install together with the stylesheets it links, so the pair stays consistent
 * across deploys; the first navigation after each worker start refreshes it and trims the asset cache.
 * Bump VERSION when this file changes in a way that needs a clean cache; activate drops every other cache.
 */
/* global self, caches, fetch, Response */
var VERSION = "hapiecoin-pwa-v1";
var OFFLINE_URL = "/offline";
var STATIC_PREFIX = "/_next/static/";
/** How many immutable assets to keep; the oldest go first (Cache keys come back in insertion order). */
var STATIC_KEEP = 200;
/** Paths the worker must never touch (prefix match; a bare prefix also matches the exact path). */
var PASS_THROUGH = ["/v1/", "/api/", "/__test/", "/_next/data/", "/_next/image", "/_next/webpack-hmr"];
var refreshedThisStart = false;

/** Decide what the worker does with a request: "static" | "navigate" | "pass". Exported for the unit test. */
function route(request, origin) {
  if (request.method !== "GET") return "pass";
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return "pass";
  }
  if (url.origin !== origin) return "pass";
  for (var i = 0; i < PASS_THROUGH.length; i++) {
    if (url.pathname === PASS_THROUGH[i].replace(/\/$/, "") || url.pathname.indexOf(PASS_THROUGH[i]) === 0) return "pass";
  }
  if (url.pathname.indexOf(STATIC_PREFIX) === 0) return "static";
  if (request.mode === "navigate") return "navigate";
  return "pass";
}

/** Only a response the server marks immutable is worth keeping (Next hashes those file names). */
function isImmutable(res) {
  var cc = res.headers && typeof res.headers.get === "function" ? res.headers.get("Cache-Control") : null;
  return typeof cc === "string" && cc.indexOf("immutable") >= 0;
}

/** The same-origin stylesheets a page links, so the cached offline page keeps its look. */
function stylesheetsOf(html) {
  var out = [];
  var tag = /<link\b[^>]*>/g;
  var m;
  while ((m = tag.exec(html)) !== null) {
    if (m[0].indexOf('rel="stylesheet"') < 0) continue;
    var href = /href="([^"]+)"/.exec(m[0]);
    if (href && href[1].indexOf("/") === 0 && href[1].indexOf("//") !== 0) out.push(href[1]);
  }
  return out;
}

/** Fetch the offline page fresh and store it with its stylesheets. Resolves either way. */
function precacheOffline(cache) {
  return fetch(OFFLINE_URL, { cache: "no-cache" })
    .then(function (res) {
      if (!res || !res.ok) return undefined;
      return res
        .clone()
        .text()
        .then(function (html) {
          return cache.put(OFFLINE_URL, res).then(function () {
            return cache.addAll(stylesheetsOf(html));
          });
        });
    })
    .catch(function () {
      return undefined;
    });
}

/** Keep the asset cache bounded: drop the oldest immutable scripts beyond STATIC_KEEP. Stylesheets stay: the cached
 * offline page links one of them and there are only a few. */
function trimStatic(cache) {
  return cache.keys().then(function (keys) {
    var statics = keys.filter(function (k) {
      var path = new URL(k.url).pathname;
      return path.indexOf(STATIC_PREFIX) === 0 && path.indexOf(STATIC_PREFIX + "css/") !== 0;
    });
    var extra = statics.length - STATIC_KEEP;
    if (extra <= 0) return undefined;
    return Promise.all(statics.slice(0, extra).map(function (k) { return cache.delete(k); }));
  });
}

function cacheFirst(request) {
  return caches.open(VERSION).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok && isImmutable(res)) cache.put(request, res.clone());
        return res;
      });
    });
  });
}

function networkFirstNavigation(request) {
  return fetch(request).catch(function () {
    return caches.open(VERSION).then(function (cache) {
      return cache.match(OFFLINE_URL).then(function (page) {
        return page || new Response("HapieCoin is offline. Prices and orders need a connection.", { status: 503, headers: { "Content-Type": "text/plain" } });
      });
    });
  });
}

/** Once per worker start, after a navigation reached the network: a fresh offline page and a bounded asset cache. */
function refreshOnce() {
  if (refreshedThisStart) return Promise.resolve();
  refreshedThisStart = true;
  return caches.open(VERSION).then(function (cache) {
    return precacheOffline(cache).then(function () {
      return trimStatic(cache);
    });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(precacheOffline).then(function () {
      return self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", function (event) {
  var kind = route(event.request, self.location.origin);
  if (kind === "static") event.respondWith(cacheFirst(event.request));
  else if (kind === "navigate") {
    event.respondWith(networkFirstNavigation(event.request));
    event.waitUntil(refreshOnce());
  }
  // "pass": no respondWith, the browser fetches as if there were no worker
});

// test seam (ADR-082): the unit test loads this file into a sandbox and reads the decision function back
self.__hapiecoinSw = { VERSION: VERSION, OFFLINE_URL: OFFLINE_URL, STATIC_KEEP: STATIC_KEEP, route: route, stylesheetsOf: stylesheetsOf, cacheFirst: cacheFirst, networkFirstNavigation: networkFirstNavigation };

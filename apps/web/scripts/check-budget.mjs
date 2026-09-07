// Bundle budget: the /analyse route's first-load JS must stay ≤ 350 KB gzipped.
//
// Next 16 (Turbopack) writes no root app-build-manifest.json; the per-route client chunk list lives in
// .next/server/app/<route>/page_client-reference-manifest.js as `globalThis.__RSC_MANIFEST["<route>"]`.
// First-load JS = root main files + polyfill (from .next/build-manifest.json) + the route's `entryJSFiles`
// (root layout + page segments). Chunks loaded later through next/dynamic (the workspace) are reported
// separately as "on demand" so the split stays visible.
// Usage: node scripts/check-budget.mjs [--limit 350] [--route /analyse/page]
/* eslint-disable no-console -- CLI report script; stdout is its output */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const limitKb = Number(args[args.indexOf("--limit") + 1] || 350);
const route = args.includes("--route") ? args[args.indexOf("--route") + 1] : "/analyse/page";
const root = process.cwd();
const nextDir = join(root, ".next");

function fail(msg, code = 2) {
  console.error(`check-budget: ${msg}`);
  process.exit(code);
}

if (!existsSync(join(nextDir, "build-manifest.json"))) fail("no .next/build-manifest.json; run `next build` first.");
const buildManifest = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8"));

const routeDir = route.replace(/\/page$/, "").replace(/^\//, "");
const refManifestPath = join(nextDir, "server", "app", routeDir, "page_client-reference-manifest.js");
if (!existsSync(refManifestPath)) fail(`no client reference manifest at ${refManifestPath}`);
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(refManifestPath, "utf8"), sandbox);
const rsc = sandbox.__RSC_MANIFEST?.[route];
if (!rsc) fail(`route ${route} not in ${refManifestPath}; keys: ${Object.keys(sandbox.__RSC_MANIFEST ?? {}).join(", ")}`);

const normalise = (f) => f.replace(/^\/?_next\//, "").replace(/^\/+/, "");
// Polyfills ship with `nomodule` and are skipped by every browser that runs this app (Next excludes them from
// its own "First Load JS" figure too); they are measured but reported separately.
const polyfills = new Set((buildManifest.polyfillFiles ?? []).map(normalise));
const firstLoad = new Set((buildManifest.rootMainFiles ?? []).map(normalise));
for (const files of Object.values(rsc.entryJSFiles ?? {})) for (const f of files) firstLoad.add(normalise(f));
const onDemand = new Set();
for (const mod of Object.values(rsc.clientModules ?? {})) {
  for (const c of mod.chunks ?? []) {
    const f = normalise(c);
    if (f.endsWith(".js") && !firstLoad.has(f)) onDemand.add(f);
  }
}

function measure(files) {
  const rows = [];
  let raw = 0;
  let gz = 0;
  for (const f of files) {
    if (!f.endsWith(".js")) continue;
    const p = join(nextDir, f);
    if (!existsSync(p)) {
      console.warn(`  (missing on disk, skipped) ${f}`);
      continue;
    }
    const buf = readFileSync(p);
    const g = gzipSync(buf, { level: 9 }).length;
    raw += buf.length;
    gz += g;
    rows.push({ f, kb: buf.length / 1024, gzKb: g / 1024 });
  }
  rows.sort((a, b) => b.gzKb - a.gzKb);
  return { rows, rawKb: raw / 1024, gzKb: gz / 1024 };
}

const first = measure(firstLoad);
const later = measure(onDemand);
const poly = measure(polyfills);
console.log(`First-load JS for ${route} (root layout + page entries):`);
for (const r of first.rows) console.log(`  ${r.gzKb.toFixed(1).padStart(7)} KB gz  ${r.kb.toFixed(1).padStart(7)} KB  ${r.f}`);
console.log(`  = ${first.rows.length} chunks, ${first.rawKb.toFixed(1)} KB raw, ${first.gzKb.toFixed(1)} KB gzipped (limit ${limitKb} KB)`);
console.log(`On demand (next/dynamic, loaded after first paint): ${later.rows.length} chunks, ${later.gzKb.toFixed(1)} KB gzipped`);
for (const r of later.rows) console.log(`  ${r.gzKb.toFixed(1).padStart(7)} KB gz  ${r.f}`);
console.log(`nomodule polyfill (legacy browsers only): ${poly.gzKb.toFixed(1)} KB gzipped`);
console.log(`Total if everything loads: ${(first.gzKb + later.gzKb).toFixed(1)} KB gzipped`);
if (first.gzKb > limitKb) fail(`FAIL — first-load ${first.gzKb.toFixed(1)} KB exceeds ${limitKb} KB`, 1);
console.log("check-budget: OK");

/**
 * Live smoke test for @hapiecoin/venues (NOT a unit test; never run under NODE_ENV=test).
 *
 *   pnpm --filter @hapiecoin/venues smoke:delta
 *
 * 1. Loads the live Delta India option list over REST and prints the BTC expiry ladders
 *    (strike counts and observed steps) to prove strikes come from the instrument list.
 * 2. Subscribes three BTC option symbols on the live ticker WebSocket for 20 s and prints
 *    each tick. Public market data only: no API key is read or sent.
 */
import { DeltaRestClient, DeltaWsClient, buildChain, listExpiries, strikeStep } from "../src/index.js";
import type { Quote } from "../src/index.js";

if (process.env.NODE_ENV === "test") {
  throw new Error("smoke-delta.ts hits live endpoints and must not run in the test environment");
}

const REST_URL = process.env.DELTA_REST_URL ?? "https://api.india.delta.exchange";
const WS_URL = process.env.DELTA_WS_URL ?? "wss://socket.india.delta.exchange";
const CHANNEL = process.env.DELTA_WS_CHANNEL === "ticker" ? "ticker" : "v2/ticker";
const RUN_MS = Number(process.env.SMOKE_MS ?? 20_000);

function fmt(q: Quote): string {
  const iv = q.markIv === null ? "-" : `${(q.markIv * 100).toFixed(1)}%`;
  const delta = q.greeks ? q.greeks.delta.toFixed(3) : "-";
  const age = q.receivedAt - q.venueTs;
  return `${new Date(q.receivedAt).toISOString()} ${q.symbol.padEnd(20)} mark ${q.mark.padStart(14)} bid ${String(q.bid).padStart(8)} ask ${String(q.ask).padStart(8)} iv ${iv.padStart(6)} Δ ${delta.padStart(6)} oi ${String(q.oi).padStart(9)} spot ${q.spot} age ${age}ms`;
}

async function main(): Promise<void> {
  const rest = new DeltaRestClient({ baseUrl: REST_URL });
  const t0 = Date.now();
  const instruments = await rest.getProducts({ contractTypes: ["call_options", "put_options"], states: ["live"] });
  console.log(`REST ${REST_URL}: ${instruments.length} live option instruments in ${Date.now() - t0} ms`);
  const byUnderlying = new Map<string, number>();
  for (const i of instruments) byUnderlying.set(i.underlying, (byUnderlying.get(i.underlying) ?? 0) + 1);
  console.log("  per underlying:", Object.fromEntries(byUnderlying));

  const quotes = await rest.getTickers({ contractTypes: ["call_options", "put_options"], underlying: "BTC" });
  console.log(`REST tickers: ${quotes.length} BTC option quotes`);

  const now = Date.now();
  console.log("BTC expiries (strikes from the instrument list, ADR-006):");
  for (const expiry of listExpiries(instruments, "BTC", now)) {
    const chain = buildChain({ instruments, quotes, underlying: "BTC", expiry: expiry.code, nowMs: now });
    const steps = strikeStep(chain.rows);
    console.log(
      `  ${expiry.label} (${expiry.code}) dte ${expiry.dte.toFixed(2).padStart(6)} strikes ${String(chain.strikes.length).padStart(3)} ` +
        `steps ${steps.steps.join("/").padEnd(12)} quoted ${chain.quoted}/${chain.total} spot ${chain.spot} range ${chain.strikes[0]}..${chain.strikes.at(-1)}`,
    );
  }

  // Pick the first expiry at least 2 days out and its three strikes around spot.
  const target = listExpiries(instruments, "BTC", now).find((e) => e.dte >= 2) ?? listExpiries(instruments, "BTC", now)[0];
  if (!target) throw new Error("no BTC expiries");
  const chain = buildChain({ instruments, quotes, underlying: "BTC", expiry: target.code, nowMs: now });
  const spot = Number(chain.spot ?? "0");
  const atmIndex = chain.rows.reduce((best, row, i) => (Math.abs(Number(row.strike) - spot) < Math.abs(Number(chain.rows[best]?.strike) - spot) ? i : best), 0);
  const picked = [chain.rows[atmIndex]?.call, chain.rows[atmIndex]?.put, chain.rows[atmIndex + 1]?.call]
    .map((side) => side?.instrument.symbol)
    .filter((s): s is string => s !== undefined);
  console.log(`WS ${WS_URL} channel ${CHANNEL}: subscribing ${picked.join(", ")} for ${RUN_MS / 1000} s`);

  const ws = new DeltaWsClient({ url: WS_URL, channel: CHANNEL });
  let ticks = 0;
  ws.on("open", () => console.log("  ws open"));
  ws.on("heartbeat", (h) => console.log(`  ws heartbeat ts_publish ${h.tsPublish}`));
  ws.on("subscriptions", (channels) => console.log("  ws subscriptions", JSON.stringify(channels)));
  ws.on("error", (e) => console.log("  ws error", e.message));
  ws.on("close", (c) => console.log("  ws close", JSON.stringify(c)));
  ws.on("reconnect", (r) => console.log("  ws reconnect", JSON.stringify(r)));
  ws.on("ticker", (q) => {
    ticks += 1;
    console.log("  " + fmt(q));
  });
  ws.subscribe(picked);
  ws.connect();

  await new Promise((resolve) => setTimeout(resolve, RUN_MS));
  ws.close();
  console.log(`done: ${ticks} ticks in ${RUN_MS / 1000} s across ${picked.length} symbols`);
}

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exitCode = 1;
});

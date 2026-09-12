// Synthetic recorded instants for the mock API's replay (ADR-079): the recorded instrument fixture's expiries, one
// end-of-day instant per day at 12:00 UTC over `days` days and a 5-minute pass every five minutes over the last two
// hours, the spot drifting a little; the ladder at an instant comes from the fixture's chain with the marks scaled by
// the spot's drift so scrubbing visibly moves them.
import type { ReplayChain, ReplayExpiries, ReplaySteps, Underlying } from "@hapiecoin/schema";
import { SPOT0, buildChain, expiriesOf } from "./fixtures/chain";

const DAY = 86_400_000;
const FIVE = 5 * 60_000;

const noonOf = (now: number) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 12);
const drift = (asset: Underlying, ms: number) => SPOT0[asset] * (1 + 0.012 * Math.sin(ms / DAY / 2));

type MockVenue = "delta_india" | "deribit";
const venueOf = (v: string | undefined): MockVenue => (v === "deribit" ? "deribit" : "delta_india");

export function mockReplayExpiries(asset: Underlying, days: number, venue?: string): ReplayExpiries {
  return { asset, venue: venueOf(venue), expiries: expiriesOf()[asset].map((expiry) => ({ expiry, days, listed: true })) };
}

export function mockReplaySteps(asset: Underlying, expiry: string, days: number, now = Date.now(), venue?: string): ReplaySteps {
  const noon = noonOf(now);
  const daily: ReplaySteps["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = noon - i * DAY;
    daily.push({ day: new Date(ts).toISOString().slice(0, 10), ts: new Date(ts).toISOString(), spot: drift(asset, ts) });
  }
  const start = Math.floor(now / FIVE) * FIVE - 24 * FIVE; // the last two hours, on five-minute marks
  const fine: ReplaySteps["fine"] = [];
  for (let k = 0; k <= 24; k++) fine.push({ ts: new Date(start + k * FIVE).toISOString(), spot: drift(asset, start + k * FIVE) });
  return { asset, venue: venueOf(venue), expiry, daily, fine };
}

/** Null when the instant is neither a daily nor a fine step of the mock. */
export function mockReplayChain(asset: Underlying, expiry: string, at: string, days: number, now = Date.now(), venue?: string): ReplayChain | null {
  const steps = mockReplaySteps(asset, expiry, days, now);
  const daily = steps.daily.find((s) => s.ts === at);
  const fine = steps.fine.find((s) => s.ts === at);
  const step = daily ?? fine;
  if (!step) return null;
  const scale = step.spot / SPOT0[asset];
  const rows = buildChain(asset, expiry, Date.parse(at)).map((r) => ({
    strike: r.strike,
    call: r.call ? { mark: Number((Number(r.call.mark) * scale).toFixed(1)), iv: r.call.markIv ?? null } : null,
    put: r.put ? { mark: Number((Number(r.put.mark) / scale).toFixed(1)), iv: r.put.markIv ?? null } : null,
  }));
  return { asset, venue: venueOf(venue), expiry, at, source: daily ? "eod" : "marks", spot: step.spot, rows };
}

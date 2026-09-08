// Expiry discovery for the Phase 1 chain panel. Order of truth: the gateway's /healthz `expiries` map,
// then the env default list. Nothing here invents a strike; expiries only pick which topic to subscribe.
import { expiryMs } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { GatewayHealth } from "../api/schemas";
import { defaultExpiries, gatewayHttpUrl } from "../env";

export interface ExpirySource {
  expiries: string[];
  source: "gateway" | "default";
}

export async function discoverExpiries(
  underlying: Underlying,
  opts: { gatewayWsUrl: string; defaultsCsv: string; fetch?: typeof fetch; today?: string; nowMs?: number; settlementHourUtc?: number },
): Promise<ExpirySource> {
  const fallback = defaultExpiries(opts.defaultsCsv);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // An expiry stays listed until its settlement instant (12:00 UTC BTC / ETH, 16:00 UTC XAUT); on the expiry
  // day after settlement the options are gone from the venue, so the list moves to the next date.
  const nowMs = opts.nowMs ?? (opts.today ? Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) : Date.now());
  const live = (d: string) => d >= today && expiryMs(d, opts.settlementHourUtc ?? (underlying === "XAUT" ? 16 : 12)) > nowMs;
  const doFetch = opts.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  if (doFetch) {
    try {
      const res = await doFetch(gatewayHttpUrl(opts.gatewayWsUrl) + "/healthz", { cache: "no-store" });
      if (res.ok) {
        const health = GatewayHealth.safeParse(await res.json());
        const list = health.success
          ? (health.data.feed?.expiries?.[underlying] ?? health.data.expiries?.[underlying])
          : undefined;
        if (list && list.length) {
          const clean = [...new Set(list.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
          if (clean.length) return { expiries: clean.filter(live), source: "gateway" };
        }
      }
    } catch {
      /* gateway has no HTTP endpoint or is down: fall through */
    }
  }
  return { expiries: fallback.filter(live), source: "default" };
}

/** First expiry on or after today, or the first in the list. */
export function nearestExpiry(expiries: readonly string[]): string | null {
  return expiries[0] ?? null;
}

// Expiry discovery for the chain panel. Order of truth: the gateway's /healthz map for the venue (`feed.venues[id]`,
// the default venue also under `feed.expiries`), then the env default list. Nothing here invents a strike; expiries only
// pick which topic to subscribe.
import { expiryMs } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE, getVenueCore } from "@hapiecoin/venues/core";
import { currentVenueId } from "@/lib/venue";
import { GatewayHealth } from "../api/schemas";
import { defaultExpiries, gatewayHttpUrl } from "../env";

export interface ExpirySource {
  expiries: string[];
  source: "gateway" | "default";
}

export async function discoverExpiries(
  underlying: Underlying,
  opts: { gatewayWsUrl: string; defaultsCsv: string; fetch?: typeof fetch; today?: string; nowMs?: number; settlementHourUtc?: number; venue?: string },
): Promise<ExpirySource> {
  const venue = opts.venue ?? currentVenueId();
  // the env list names the default venue's dates; another venue lists its own or nothing
  const fallback = venue === DEFAULT_VENUE ? defaultExpiries(opts.defaultsCsv) : [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // An expiry stays listed until its settlement instant (the venue calendar: Delta 12:00 UTC BTC / ETH and 16:00 UTC XAUT,
  // Deribit 08:00 UTC); on the expiry day after settlement the options are gone from the venue, so the list moves on.
  const nowMs = opts.nowMs ?? (opts.today ? Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) : Date.now());
  const live = (d: string) => d >= today && expiryMs(d, opts.settlementHourUtc ?? getVenueCore(venue).calendar.settlementHourUtc(underlying)) > nowMs;
  const doFetch = opts.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  if (doFetch) {
    try {
      const res = await doFetch(gatewayHttpUrl(opts.gatewayWsUrl) + "/healthz", { cache: "no-store" });
      if (res.ok) {
        const health = GatewayHealth.safeParse(await res.json());
        const list = !health.success ? undefined : venue === DEFAULT_VENUE ? (health.data.feed?.expiries?.[underlying] ?? health.data.expiries?.[underlying]) : health.data.feed?.venues?.[venue]?.expiries?.[underlying];
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

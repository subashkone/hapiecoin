/**
 * Market history read routes (ADR-056; GAPS #62, #31, #32). Public like the analytics snapshots: venue market data, no
 * account behind it.
 *
 *   GET /v1/market/iv?asset=BTC              front-expiry ATM IV series, IV rank, realised vol, 24 h spot range
 *   GET /v1/market/marks/{symbol}?hours=24   one option's mark and mark IV history for the details sparkline
 */
import { IvHistory, MarkHistory, Underlying, Venue } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ivHistory, markHistory } from "../market-history.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { type AppDeps, errorResponses, jsonContent } from "./shared.js";

const IvQuery = z.object({ asset: z.string().optional(), venue: z.string().optional() });
const SymbolParam = z.object({ symbol: z.string().min(1).max(64) });
const MarksQuery = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24), venue: z.string().optional() });

/** ADR-065: an optional `venue` query; absent means the default venue, unknown is a 400. */
function venueOf(raw: string | undefined): Venue {
  if (raw === undefined) return DEFAULT_VENUE;
  const parsed = Venue.safeParse(raw);
  if (!parsed.success) throw errors.badRequest(`unknown venue ${raw}`);
  return parsed.data;
}

export function registerMarketRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => number = Date.now): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/market/iv",
      tags: ["market"],
      summary: "ATM IV history, IV rank and realised vol for one underlying (HC-WS-096, HC-WS-097)",
      request: { query: IvQuery },
      responses: { 200: jsonContent(IvHistory, "IV history"), 400: errorResponses[400], 503: errorResponses[503] },
    }),
    async (c) => {
      const parsed = Underlying.safeParse((c.req.valid("query").asset ?? "").toUpperCase());
      if (!parsed.success) throw errors.badRequest("asset must be BTC, ETH or XAUT");
      const out = await ivHistory(deps.db, parsed.data, now, venueOf(c.req.valid("query").venue));
      if (out.asOf === null) throw errors.unavailable(`no IV history for ${parsed.data} yet; the snapshotter records the first point within minutes of the API start`);
      c.header("Cache-Control", "public, max-age=60");
      return c.json(out, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/market/marks/{symbol}",
      tags: ["market"],
      summary: "Mark and mark IV history of one option (HC-WS-026 sparkline)",
      request: { params: SymbolParam, query: MarksQuery },
      responses: { 200: jsonContent(MarkHistory, "Mark history"), 400: errorResponses[400] },
    }),
    async (c) => {
      const { symbol } = c.req.valid("param");
      const { hours, venue } = c.req.valid("query");
      c.header("Cache-Control", "public, max-age=60");
      return c.json(await markHistory(deps.db, symbol, hours, now, venueOf(venue)), 200);
    },
  );
}

/**
 * Market Analytics read routes (Phase 5 item 5, ADR-038). Public: the landing page and the analytics pages read them
 * without a session. Every payload is the ingest service's snapshot envelope with `source`, `asOf` and `stale`.
 *
 *   GET /v1/analytics/{dataset}?symbol=BTC   one snapshot (symbol required for per-symbol datasets)
 *   503 UNAVAILABLE when nothing has been ingested yet for that key.
 */
import { ANALYTICS_DATASETS, AnalyticsDataset, AnalyticsSnapshot, AnalyticsSymbol, SYMBOL_DATASETS, analyticsKey } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { type AppDeps, errorResponses, jsonContent } from "./shared.js";

const Params = z.object({ dataset: AnalyticsDataset });
const Query = z.object({ symbol: z.string().optional() });

export function registerAnalyticsRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/analytics/{dataset}",
      tags: ["analytics"],
      summary: `One analytics snapshot (${ANALYTICS_DATASETS.join(", ")})`,
      request: { params: Params, query: Query },
      responses: { 200: jsonContent(AnalyticsSnapshot, "Snapshot"), 400: errorResponses[400], 503: errorResponses[503] },
    }),
    async (c) => {
      const { dataset } = c.req.valid("param");
      const { symbol } = c.req.valid("query");
      let key: string;
      if (SYMBOL_DATASETS.has(dataset)) {
        const parsed = AnalyticsSymbol.safeParse((symbol ?? "").toUpperCase());
        if (!parsed.success) throw errors.badRequest(`symbol is required for ${dataset} (e.g. BTC)`);
        key = analyticsKey(dataset, parsed.data);
      } else {
        key = analyticsKey(dataset);
      }
      const snapshot = await deps.analytics.get(key);
      if (!snapshot) throw errors.unavailable(`${dataset} is not available yet; the ingest service has not written ${key}`);
      c.header("Cache-Control", `public, max-age=${Math.max(5, Math.min(60, Math.floor(snapshot.ttlMs / 4000)))}`);
      c.header("X-As-Of", new Date(snapshot.asOf).toISOString());
      return c.json(snapshot, 200);
    },
  );
}

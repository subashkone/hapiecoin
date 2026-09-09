/**
 * alternative.me Crypto Fear & Greed Index (api.alternative.me/fng/?limit=0, free, no key; verified 09 Sep 2026).
 * `limit=0` returns the whole daily history newest first; timestamps are unix seconds as strings.
 */
import { type FearGreedData, fearGreedLabel } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";

const Row = z.looseObject({ value: z.coerce.number().int().min(0).max(100), value_classification: z.string().optional(), timestamp: z.coerce.number() });
const Body = z.looseObject({ data: z.array(Row) });

export class FearGreedAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly url: string,
  ) {}

  async history(): Promise<FearGreedData> {
    const body = await this.http.get(this.url, Body, { limit: 0, format: "json" });
    const points = body.data.map((r) => ({ t: r.timestamp * 1000, v: r.value })).sort((a, b) => a.t - b.t);
    const last = points[points.length - 1];
    if (!last) throw new Error("Fear & Greed: empty history");
    const latestRow = body.data.find((r) => r.timestamp * 1000 === last.t);
    return { points, latest: { value: last.v, label: latestRow?.value_classification ?? fearGreedLabel(last.v), at: last.t } };
  }
}

/**
 * Delta Exchange India public tickers (api.india.delta.exchange, verified 09 Sep 2026):
 *   GET /v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC
 * Response { success, result: [{ symbol: "P-BTC-97000-271126", contract_type, strike_price, oi_value (underlying
 * units), oi_value_usd, turnover_usd, spot_price, ... }] }. Symbols are C|P-BASE-STRIKE-DDMMYY; BTC/ETH options settle
 * 12:00 UTC on the expiry day (same fact as packages/venues). The venue package is not reused here so the ingest
 * stays a thin JSON client like the other adapters (ADR-042).
 */
import { z } from "zod";
import type { JsonClient } from "../http.js";
import type { OptionInstrument } from "./deribit.js";

const num = z.coerce.number();
const Row = z.looseObject({ symbol: z.string(), contract_type: z.string().nullish(), strike_price: num.nullish(), oi_value: num.nullish(), turnover_usd: num.nullish(), spot_price: num.nullish() });
const Body = z.looseObject({ success: z.boolean().optional(), result: z.array(Row) });
const SYMBOL = /^([CP])-([A-Z0-9]+)-(\d+(?:\.\d+)?)-(\d{2})(\d{2})(\d{2})$/;

/** Parse "P-BTC-97000-271126"; null for anything else. */
export function parseDeltaSymbol(symbol: string): Omit<OptionInstrument, "oi" | "volumeUsd" | "underlyingPrice"> | null {
  const m = SYMBOL.exec(symbol);
  if (!m) return null;
  const [, cp, base, strike, dd, mm, yy] = m;
  const expiry = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), 12, 0, 0);
  if (Number.isNaN(expiry) || Number(mm) < 1 || Number(mm) > 12) return null;
  return { name: symbol, base: base!, expiry, label: `${dd}${mm}${yy}`, strike: Number(strike), type: cp === "C" ? "call" : "put" };
}

export class DeltaAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
  ) {}

  async options(underlying: string): Promise<OptionInstrument[]> {
    const body = await this.http.get(`${this.baseUrl}/v2/tickers`, Body, { contract_types: "call_options,put_options", underlying_asset_symbols: underlying.toUpperCase() });
    const out: OptionInstrument[] = [];
    for (const r of body.result) {
      const parsed = parseDeltaSymbol(r.symbol);
      if (!parsed) continue;
      out.push({ ...parsed, oi: r.oi_value ?? 0, volumeUsd: r.turnover_usd ?? 0, underlyingPrice: r.spot_price ?? null });
    }
    return out;
  }
}

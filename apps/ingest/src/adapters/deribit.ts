/**
 * Deribit v2 public API (docs.deribit.com, verified 09 Sep 2026; base https://www.deribit.com/api/v2).
 *   GET /public/get_book_summary_by_currency?currency=BTC&kind=option
 * Response { result: [{ instrument_name: "BTC-25SEP26-105000-C", open_interest (underlying units for options),
 * volume_usd, mark_price, underlying_price, mark_iv, ... }] }. Instrument names are BASE-DDMMMYY-STRIKE-C|P and
 * options settle at 08:00 UTC on the expiry day. Unauthenticated rate limits are not stated on the docs page we
 * could reach, so the job polls once per currency every few minutes (ADR-042).
 */
import { z } from "zod";
import type { JsonClient } from "../http.js";

const num = z.coerce.number();
const Row = z.looseObject({ instrument_name: z.string(), open_interest: num.nullable().optional(), volume_usd: num.nullable().optional(), underlying_price: num.nullable().optional(), mark_price: num.nullable().optional() });
const Body = z.looseObject({ result: z.array(Row) });

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const NAME = /^([A-Z0-9]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-([CP])$/;

/** One listed option with what the options job needs; shared by every options venue adapter. */
export interface OptionInstrument {
  name: string;
  base: string;
  /** Settlement instant (ms). */
  expiry: number;
  /** Venue expiry label ("25SEP26"). */
  label: string;
  strike: number;
  type: "call" | "put";
  /** Open interest in underlying units. */
  oi: number;
  volumeUsd: number;
  underlyingPrice: number | null;
}

/** Parse "BTC-25SEP26-105000-C" (Deribit writes decimal strikes as "0d5"); null for anything else. */
export function parseDeribitName(name: string): Omit<OptionInstrument, "oi" | "volumeUsd" | "underlyingPrice"> | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, base, day, mon, yy, strikeRaw, cp] = m;
  const month = MONTHS[mon!];
  if (month === undefined) return null;
  const expiry = Date.UTC(2000 + Number(yy), month, Number(day), 8, 0, 0);
  return { name, base: base!, expiry, label: `${day}${mon}${yy}`, strike: Number(strikeRaw!.replace("d", ".")), type: cp === "C" ? "call" : "put" };
}

export class DeribitAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
  ) {}

  async options(currency: string): Promise<OptionInstrument[]> {
    const body = await this.http.get(`${this.baseUrl}/public/get_book_summary_by_currency`, Body, { currency: currency.toUpperCase(), kind: "option" });
    const out: OptionInstrument[] = [];
    for (const r of body.result) {
      const parsed = parseDeribitName(r.instrument_name);
      if (!parsed) continue;
      out.push({ ...parsed, oi: r.open_interest ?? 0, volumeUsd: r.volume_usd ?? 0, underlyingPrice: r.underlying_price ?? null });
    }
    return out;
  }
}

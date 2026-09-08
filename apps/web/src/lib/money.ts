// Money for the screen (HC-WS-031, HC-TR-091): USD by default, INR at the stored conversion rate when the
// currency setting is INR. Values arrive as numbers from the pricing engine (position P&L) or as decimal
// strings from quotes; the conversion happens once, at the edge, and is never written back (typescript rule 3).

export type Currency = "USD" | "INR";

export interface MoneyFormat {
  currency: Currency;
  /** INR per USD as the settings store it (decimal string); ignored for USD. */
  rate: string;
}

export const USD: MoneyFormat = { currency: "USD", rate: "1" };

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  // ±Infinity is a real answer (unbounded P&L); NaN is not.
  return Number.isNaN(n) ? null : n;
}

export function convert(usd: number, fmt: MoneyFormat): number {
  if (fmt.currency === "USD") return usd;
  const r = Number(fmt.rate);
  return Number.isFinite(r) && r > 0 ? usd * r : usd;
}

/** "$1,234.50" / "₹1,03,045.00"; `signed` prefixes + / − for P&L; non-finite → "Unlimited" or "—". */
export function fmtMoney(value: string | number | undefined, fmt: MoneyFormat = USD, opts: { signed?: boolean; digits?: number; unlimited?: string } = {}): string {
  const n = toNumber(value);
  if (n === null) return "—";
  if (!Number.isFinite(n)) return opts.unlimited ?? "Unlimited";
  const digits = opts.digits ?? 2;
  const v = convert(n, fmt);
  const abs = Math.abs(v).toLocaleString(fmt.currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const symbol = fmt.currency === "INR" ? "₹" : "$";
  const sign = v < 0 ? "−" : opts.signed && v > 0 ? "+" : "";
  return `${sign}${symbol}${abs}`;
}

/** Compact money for tight spots: "$1.2K", "$94", "₹1.0L" (lakh) for INR. */
export function fmtMoneyCompact(value: number | undefined, fmt: MoneyFormat = USD): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const v = convert(value, fmt);
  const symbol = fmt.currency === "INR" ? "₹" : "$";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (fmt.currency === "INR" && a >= 100_000) return `${sign}${symbol}${(a / 100_000).toFixed(1)}L`;
  if (a >= 1_000_000) return `${sign}${symbol}${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}${symbol}${(a / 1_000).toFixed(1)}K`;
  return `${sign}${symbol}${a.toFixed(a < 10 ? 2 : 0)}`;
}

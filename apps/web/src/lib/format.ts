// Display formatting. Inputs are decimal strings or numbers; output is text for the screen only.
// Money never round-trips through these functions back into storage (typescript rule 3).

/** Format a price-like decimal string with grouping and the given fraction digits. */
export function fmtPrice(value: string | number | undefined, digits?: number): string {
  if (value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const d = digits ?? (Math.abs(n) >= 1000 ? 1 : 2);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** "+1.23%" / "-0.45%" with sign; undefined → "—". */
export function fmtPct(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const s = value.toFixed(digits);
  return (value > 0 ? "+" : "") + s + "%";
}

/** IV as a decimal fraction (0.42) → "42.0%". */
export function fmtIv(iv: number | undefined): string {
  if (iv === undefined || !Number.isFinite(iv)) return "—";
  return (iv * 100).toFixed(1) + "%";
}

/** Delta → two decimals with sign for puts. */
export function fmtDelta(delta: number | undefined): string {
  if (delta === undefined || !Number.isFinite(delta)) return "—";
  return delta.toFixed(2);
}

/** Open interest in contracts → compact ("10.2K"). */
export function fmtOi(oi: string | undefined): string {
  if (oi === undefined) return "—";
  const n = Number(oi);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Strike decimal string → grouped integer text ("79,500"). */
export function fmtStrike(strike: string): string {
  const n = Number(strike);
  if (!Number.isFinite(n)) return strike;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** USD amount (decimal string) → "$1,000.00". */
export function fmtUsd(value: string | number | undefined): string {
  if (value === undefined) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** ISO date "2026-09-25" → "25 Sep" (chip label) ; with year → "25 Sep 2026". */
export function fmtExpiry(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${m[3]} ${mon}${withYear ? " " + m[1] : ""}`;
}

/** Whole days from `now` to the expiry's 12:00 UTC settlement (never negative). */
export function daysToExpiry(iso: string, now: Date = new Date()): number {
  const settle = Date.parse(iso + "T12:00:00Z");
  if (!Number.isFinite(settle)) return 0;
  return Math.max(0, Math.round((settle - now.getTime()) / 86_400_000));
}

/** ISO date-time → "25 Sep 2026" (Indian-style day-first, as in the mock). */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}

/**
 * Decimal-string helpers. Money and quantities cross package boundaries as decimal strings
 * (brief: "Money and quantities cross package boundaries as decimal strings"); these helpers
 * canonicalise what the venue sends ("0.100000000000000000" -> "0.1") without ever going
 * through binary floating point for values that were already strings.
 */

const PLAIN_DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const EXPONENT_DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

export class DecimalFormatError extends TypeError {
  readonly input: string;
  constructor(input: string) {
    super(`Not a decimal string: ${JSON.stringify(input)}`);
    this.name = "DecimalFormatError";
    this.input = input;
  }
}

/** Expand "1.5e-7" style strings into plain positional notation ("0.00000015"). */
function expandExponent(sign: string, int: string, frac: string, exponent: number): string {
  const digits = int + frac;
  const pointPos = int.length + exponent;
  if (pointPos <= 0) return `${sign}0.${"0".repeat(-pointPos)}${digits}`;
  if (pointPos >= digits.length) return `${sign}${digits}${"0".repeat(pointPos - digits.length)}`;
  return `${sign}${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
}

/**
 * Canonical form of a decimal string: optional leading "-", no "+", no leading zeros on the
 * integer part, no trailing zeros on the fraction, no exponent, and "-0" collapses to "0".
 * Throws DecimalFormatError for anything that is not a decimal literal.
 */
export function canonDecimal(input: string): string {
  const trimmed = input.trim();
  let match = PLAIN_DECIMAL.exec(trimmed);
  if (!match) {
    const exp = EXPONENT_DECIMAL.exec(trimmed);
    if (!exp) throw new DecimalFormatError(input);
    match = PLAIN_DECIMAL.exec(expandExponent(exp[1] ?? "", exp[2] ?? "0", exp[3] ?? "", Number(exp[4])));
    /* v8 ignore next -- expandExponent always yields a plain decimal; guard keeps the type narrow */
    if (!match) throw new DecimalFormatError(input);
  }
  const sign = match[1] === "-" ? "-" : "";
  const int = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const frac = (match[3] ?? "").replace(/0+$/, "");
  const body = frac.length > 0 ? `${int}.${frac}` : int;
  if (body === "0") return "0";
  return sign + body;
}

/**
 * Convert a JS number the venue emitted (e.g. `volume: 0.9570000000000001`) into a canonical
 * decimal string. Uses 15 significant digits, which removes binary-float noise for the
 * magnitudes Delta publishes. Throws for NaN / Infinity.
 */
export function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new DecimalFormatError(String(value));
  return canonDecimal(value.toPrecision(15));
}

/** Parse a decimal string to a number for pure math only (never for storage). Returns null for null/invalid input. */
export function decimalToNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Numeric comparison of two decimal strings (safe for the magnitudes used in strike ladders). */
export function compareDecimal(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

import { describe, expect, it } from "vitest";
import { EXPIRY_MONTHS, ExpiryCode, dateToExpiryCode, expiryCodeToDate } from "./expiry.js";

describe("HC-WS-007 ExpiryCode", () => {
  it.each(["25SEP26", "01JAN00", "31DEC99", "29FEB28", "30APR26"])("accepts %s", (code) => {
    expect(ExpiryCode.safeParse(code).success).toBe(true);
  });
  it.each(["25sep26", "5SEP26", "25SEP2026", "25SEPT26", "00JAN26", "32JAN26", "31FEB26", "29FEB27", "31APR26", "", "SEP26"])(
    "rejects %s",
    (code) => {
      expect(ExpiryCode.safeParse(code).success).toBe(false);
    },
  );
  it("exposes months in order", () => {
    expect(EXPIRY_MONTHS).toHaveLength(12);
    expect(EXPIRY_MONTHS[0]).toBe("JAN");
    expect(EXPIRY_MONTHS[11]).toBe("DEC");
  });
});

describe("HC-WS-007 expiry helpers", () => {
  it("expiryCodeToDate converts DDMMMYY to YYYY-MM-DD", () => {
    expect(expiryCodeToDate("25SEP26")).toBe("2026-09-25");
    expect(expiryCodeToDate("01JAN00")).toBe("2000-01-01");
    expect(expiryCodeToDate("29FEB28")).toBe("2028-02-29");
  });
  it("expiryCodeToDate throws on malformed codes and impossible dates", () => {
    expect(() => expiryCodeToDate("25sep26")).toThrow(RangeError);
    expect(() => expiryCodeToDate("31FEB26")).toThrow(/not a real calendar date/);
    expect(() => expiryCodeToDate("29FEB27")).toThrow(RangeError);
  });
  it("dateToExpiryCode converts YYYY-MM-DD to DDMMMYY", () => {
    expect(dateToExpiryCode("2026-09-25")).toBe("25SEP26");
    expect(dateToExpiryCode("2000-01-01")).toBe("01JAN00");
    expect(dateToExpiryCode("2099-12-31")).toBe("31DEC99");
  });
  it("dateToExpiryCode throws on malformed input, impossible dates and years outside 2000–2099", () => {
    expect(() => dateToExpiryCode("25SEP26")).toThrow(/invalid ISO date/);
    expect(() => dateToExpiryCode("2026-13-01")).toThrow(/not a real calendar date/);
    expect(() => dateToExpiryCode("2026-00-10")).toThrow(RangeError);
    expect(() => dateToExpiryCode("2026-02-30")).toThrow(RangeError);
    expect(() => dateToExpiryCode("2026-04-00")).toThrow(RangeError);
    expect(() => dateToExpiryCode("1999-12-31")).toThrow(/out of range/);
    expect(() => dateToExpiryCode("2100-01-01")).toThrow(/out of range/);
  });
  it("round-trips every day of 2026 and 2028 (leap year)", () => {
    for (const year of [2026, 2028]) {
      for (let month = 1; month <= 12; month++) {
        const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
        for (let day = 1; day <= days; day++) {
          const iso = `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const code = dateToExpiryCode(iso);
          expect(ExpiryCode.safeParse(code).success).toBe(true);
          expect(expiryCodeToDate(code)).toBe(iso);
        }
      }
    }
  });
});

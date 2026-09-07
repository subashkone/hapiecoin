import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, ApiErrorCode, paginated } from "./api.js";
import type { Paginated } from "./api.js";

describe("[SCHEMA] ApiError", () => {
  it("accepts code + message with optional details", () => {
    expect(ApiError.safeParse({ code: "NOT_FOUND", message: "no such strategy" }).success).toBe(true);
    expect(
      ApiError.safeParse({ code: "VALIDATION_FAILED", message: "bad input", details: { field: "strike" } }).success,
    ).toBe(true);
  });
  it("rejects lower-case codes, blank messages and non-object details", () => {
    expect(ApiError.safeParse({ code: "not_found", message: "x" }).success).toBe(false);
    expect(ApiError.safeParse({ code: "NOT_FOUND", message: "" }).success).toBe(false);
    expect(ApiError.safeParse({ code: "NOT_FOUND" }).success).toBe(false);
    expect(ApiError.safeParse({ code: "NOT_FOUND", message: "x", details: "why" }).success).toBe(false);
    expect(ApiErrorCode.safeParse("1BAD").success).toBe(false);
    expect(ApiErrorCode.safeParse("RATE_LIMITED_429").success).toBe(true);
  });
});

describe("[SCHEMA] paginated", () => {
  const Page = paginated(z.object({ id: z.string() }));
  it("accepts a page with a cursor, a last page and an optional total", () => {
    expect(Page.safeParse({ items: [{ id: "a" }], nextCursor: "c2" }).success).toBe(true);
    expect(Page.safeParse({ items: [], nextCursor: null, total: 0 }).success).toBe(true);
  });
  it("rejects missing cursor, empty cursor, bad items and negative totals", () => {
    expect(Page.safeParse({ items: [] }).success).toBe(false);
    expect(Page.safeParse({ items: [], nextCursor: "" }).success).toBe(false);
    expect(Page.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
    expect(Page.safeParse({ items: [], nextCursor: null, total: -1 }).success).toBe(false);
    expect(Page.safeParse({ items: [], nextCursor: null, total: 1.5 }).success).toBe(false);
  });
  it("the inferred type is assignable to the Paginated<T> helper", () => {
    // Compile-time check: z.infer<typeof Page> must be assignable to Paginated<{ id: string }>.
    const page: Paginated<{ id: string }> = Page.parse({ items: [{ id: "a" }], nextCursor: null });
    expect(page.items[0]?.id).toBe("a");
    expect(page.nextCursor).toBeNull();
  });
});

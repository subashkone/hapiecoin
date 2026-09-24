// GAPS #114: the test clock the setup installs. Every file starts at TEST_NOW and time flows at real speed.
import { describe, expect, it } from "vitest";
import { TEST_NOW } from "./setup";

describe("GAPS #114 the test clock", () => {
  it("starts each file at 7 Sep 2026 10:00 UTC and flows at real speed", async () => {
    const t0 = Date.now();
    expect(Math.abs(t0 - TEST_NOW)).toBeLessThan(60_000); // within a minute of the pin, however slow the file loaded
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-07");
    const p0 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    const elapsed = performance.now() - p0;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(Math.floor(elapsed) - 5); // no lag, unlike a faked Date that advances on a timer
  });

  it("is the real Date in every other respect: explicit constructors, statics, the plain call and instanceof", () => {
    expect(new Date("2026-01-01T00:00:00Z").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(2026, 0, 2, 3, 4, 5).getFullYear()).toBe(2026);
    expect(new Date(0).getTime()).toBe(0);
    expect(Date.UTC(2026, 8, 7, 10)).toBe(TEST_NOW);
    expect(Date.parse("2026-09-07T10:00:00Z")).toBe(TEST_NOW);
    expect(typeof Date()).toBe("string");
    expect(Date()).toContain("2026");
    expect(new Date() instanceof Date).toBe(true);
    expect(Object.prototype.toString.call(new Date())).toBe("[object Date]");
  });
});

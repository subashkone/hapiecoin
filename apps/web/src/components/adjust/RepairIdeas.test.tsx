// Repair ideas panel (ADR-094; HC-TR-195): the settle rule that keeps the menu from re-building on every tick.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDEAS_REFRESH_MS, useSettled } from "./RepairIdeas";

describe("HC-TR-195 the ideas follow the market on a timer and the position at once", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("HC-TR-195 a market move is held until the refresh, a change of structure applies at once, and the timer is cleared on unmount", () => {
    expect(IDEAS_REFRESH_MS).toBe(2_000);
    const first = { spot: 80_400 };
    const { result, rerender, unmount } = renderHook(({ live, structure }: { live: { spot: number }; structure: string }) => useSettled(live, structure, IDEAS_REFRESH_MS), { initialProps: { live: first, structure: "a" } });
    expect(result.current).toBe(first);
    // ticks arrive: the settled value does not move with them
    const tick1 = { spot: 80_410 };
    const tick2 = { spot: 80_420 };
    rerender({ live: tick1, structure: "a" });
    rerender({ live: tick2, structure: "a" });
    expect(result.current).toBe(first);
    act(() => void vi.advanceTimersByTime(IDEAS_REFRESH_MS - 1));
    expect(result.current).toBe(first);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(tick2); // the latest one, not every one in between
    // a leg closed, another expiry picked, a chain arriving: no waiting
    const moved = { spot: 80_430 };
    rerender({ live: moved, structure: "b" });
    expect(result.current).toBe(moved);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

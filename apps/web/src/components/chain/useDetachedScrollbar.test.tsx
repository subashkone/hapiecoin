// HC-WS-015 / GAPS #128: a detached scrollbar follows the state, never while its thumb is held, and drops the echo of
// its own writes. Driven through ChainTable at 600 px (max offset 74, as in chain.test.tsx) with the bars given a
// real scroll range and a hand-driven animation frame.
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain } from "../../../test/fixtures/chain";
import { renderWithProviders } from "../../../test/helpers";
import { defaultLayout } from "@/lib/chain/layout";
import { applySnapshot, emptyChain } from "@/lib/gateway/reducer";
import { ChainTable, type ChainTableProps } from "./ChainTable";

const TOPIC = "chain:delta_india:BTC:2026-09-25";
const rows = buildChain("BTC", "2026-09-25");

function props(): ChainTableProps {
  return {
    chain: applySnapshot(emptyChain(TOPIC), 0, rows, 1),
    spot: "79521",
    height: 520,
    range: 12,
    onRange: vi.fn(),
    layout: defaultLayout(),
    expiryLabel: "25 Sep",
    daysLeft: 18,
    lotLabel: "Lot ₿ · USD per contract",
    live: true,
    asOf: null,
    onAddLeg: vi.fn(),
    initialWidth: 600,
  } as unknown as ChainTableProps;
}

/** jsdom has no layout: give a bar the essentials track (328 px) in a 254 px box, so its own maximum is 74 like the state's. */
function sizeBar(el: HTMLElement, scrollWidth = 328, clientWidth = 254) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((cb) => cb(0)));
};

describe("HC-WS-015 / GAPS #128 the detached scrollbar and a held thumb", () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.splice(id - 1, 1);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the state in an animation frame, but not while the thumb is held, and catches up on release", () => {
    renderWithProviders(<ChainTable {...props()} />);
    const table = screen.getByTestId("chain-table");
    const calls = screen.getByTestId("chain-scrollbar-calls");
    const puts = screen.getByTestId("chain-scrollbar-puts");
    sizeBar(calls);
    sizeBar(puts);
    expect(table.dataset["x"]).toBe("74");
    // the mouse takes the calls thumb; the state moves because the puts track is scrolled by a wheel
    fireEvent.mouseDown(calls, { button: 0 });
    calls.scrollLeft = 74;
    act(() => {
      screen.getByTestId("chain-puts").dispatchEvent(new WheelEvent("wheel", { deltaX: 10, bubbles: true, cancelable: true }));
    });
    expect(table.dataset["x"]).toBe("64");
    flushFrames();
    expect(calls.scrollLeft).toBe(74); // held: not written
    expect(puts.scrollLeft).toBe(10); // the other bar follows
    // released: one catch-up write, whose scroll event is an echo and changes nothing
    fireEvent.mouseUp(window, { button: 0 });
    expect(calls.scrollLeft).toBe(64);
    fireEvent.scroll(calls);
    expect(table.dataset["x"]).toBe("64");
    // a real scroll on the bar still drives the state
    calls.scrollLeft = 30;
    fireEvent.scroll(calls);
    expect(table.dataset["x"]).toBe("30");
    expect(table.dataset["putsX"]).toBe("44");
  });

  it("a window blur releases the thumb, and a right button never holds it", () => {
    renderWithProviders(<ChainTable {...props()} />);
    const table = screen.getByTestId("chain-table");
    const calls = screen.getByTestId("chain-scrollbar-calls");
    sizeBar(calls);
    sizeBar(screen.getByTestId("chain-scrollbar-puts"));
    calls.scrollLeft = 74;
    fireEvent.mouseDown(calls, { button: 0 });
    fireEvent.blur(window);
    act(() => {
      screen.getByTestId("chain-puts").dispatchEvent(new WheelEvent("wheel", { deltaX: 20, bubbles: true, cancelable: true }));
    });
    expect(table.dataset["x"]).toBe("54");
    flushFrames();
    expect(calls.scrollLeft).toBe(54); // released by the blur: written
    fireEvent.mouseDown(calls, { button: 2 });
    act(() => {
      screen.getByTestId("chain-puts").dispatchEvent(new WheelEvent("wheel", { deltaX: 10, bubbles: true, cancelable: true }));
    });
    flushFrames();
    expect(calls.scrollLeft).toBe(44); // a right click is not a hold
  });
});

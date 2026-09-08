import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExpiryStrip } from "./ExpiryStrip";

function chips(n: number) {
  return Array.from({ length: n }, (_, i) => (
    <button key={i} type="button" role="tab" data-testid="chip">
      {i}
    </button>
  ));
}

describe("HC-WS-008 expiry strip scroll arrows", () => {
  it("hides the arrows while the chips fit and shows them once the strip overflows", () => {
    const { unmount } = render(<ExpiryStrip>{chips(3)}</ExpiryStrip>);
    expect(screen.getByTestId("expiry-strip").dataset["overflow"]).toBe("false");
    expect(screen.queryByTestId("expiry-strip-next")).toBeNull();
    unmount();
    // jsdom has no layout: pretend the row is wider than its box
    const sw = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
    const cw = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    const scrollBy = vi.fn();
    HTMLElement.prototype.scrollBy = scrollBy;
    render(<ExpiryStrip testId="picker-strip">{chips(30)}</ExpiryStrip>);
    expect(screen.getByTestId("picker-strip").dataset["overflow"]).toBe("true");
    fireEvent.click(screen.getByTestId("picker-strip-next"));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 180, behavior: "smooth" });
    fireEvent.click(screen.getByTestId("picker-strip-prev"));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -180, behavior: "smooth" });
    expect(screen.getByRole("tablist", { name: "Expiry" })).toBeTruthy();
    sw.mockRestore();
    cw.mockRestore();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DENSITY_STORAGE_KEY, DensityProvider, applyDensity, useDensity } from "./DensityProvider";

function Probe() {
  const { density, setDensity, toggleDensity } = useDensity();
  return (
    <div>
      <output>{density}</output>
      <button type="button" onClick={toggleDensity}>
        toggle
      </button>
      <button type="button" onClick={() => setDensity("compact")}>
        compact
      </button>
    </div>
  );
}

const html = () => document.documentElement;

describe("HC-SH-080 DensityProvider sets the compact class (HC-SH-113 --row-h 36px / 28px)", () => {
  it("HC-SH-080 starts comfortable, toggles to compact, sets class + data-density, persists", async () => {
    const user = userEvent.setup();
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("comfortable");
    expect(html().classList.contains("compact")).toBe(false);
    expect(html().dataset["density"]).toBe("comfortable");

    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByRole("status").textContent).toBe("compact");
    expect(html().classList.contains("compact")).toBe(true);
    expect(html().dataset["density"]).toBe("compact");
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");

    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(html().classList.contains("compact")).toBe(false);
    await user.click(screen.getByRole("button", { name: "compact" }));
    expect(html().classList.contains("compact")).toBe(true);
  });

  it("HC-SH-113 restores a stored density and ignores invalid values", () => {
    window.localStorage.setItem("d", "compact");
    const first = render(
      <DensityProvider storageKey="d">
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("compact");
    first.unmount();

    window.localStorage.setItem("d", "huge");
    render(
      <DensityProvider storageKey="d" defaultDensity="comfortable">
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("comfortable");
  });

  it("HC-SH-080 survives a throwing localStorage and throws outside a provider", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      render(
        <DensityProvider>
          <Probe />
        </DensityProvider>,
      );
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(screen.getByRole("status").textContent).toBe("compact");
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
    }

    function Bad() {
      useDensity();
      return null;
    }
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Bad />)).toThrow(/inside <DensityProvider>/);
    err.mockRestore();
  });

  it("HC-SH-113 applyDensity works on any root element", () => {
    const root = document.createElement("div");
    applyDensity("compact", root);
    expect(root.classList.contains("compact")).toBe(true);
    expect(root.dataset["density"]).toBe("compact");
    applyDensity("comfortable", root);
    expect(root.classList.contains("compact")).toBe(false);
  });
});

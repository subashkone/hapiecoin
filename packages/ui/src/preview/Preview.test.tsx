import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Preview } from "./Preview";

describe("HC-PB-060 Preview renders every component in both themes", () => {
  it("HC-PB-060 renders a light and a dark panel with every section", () => {
    render(<Preview />);
    const light = document.querySelector('[data-theme="light"]');
    const dark = document.querySelector('[data-theme="dark"]');
    expect(light?.classList.contains("light")).toBe(true);
    expect(dark?.classList.contains("dark")).toBe(true);
    for (const theme of ["light", "dark"]) {
      for (const s of [
        "buttons",
        "badges",
        "forms",
        "tabs",
        "controls",
        "dialog-toast",
        "table",
        "stats",
        "empty",
      ]) {
        expect(document.querySelector(`[data-section="${theme}-${s}"]`)).toBeTruthy();
      }
    }
    // 7 variants x (4 sizes + loading + disabled) per theme
    expect(document.querySelectorAll('[data-section="dark-buttons"] [data-slot="button"]')).toHaveLength(42);
  });

  it("HC-SH-113 compact mode marks both panels and their tables", () => {
    render(<Preview compact />);
    expect(document.querySelectorAll('[data-density="compact"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="table"][data-compact="true"]')).toHaveLength(2);
  });

  it("HC-PB-060 interactive parts work inside the preview (switch, select, dialog, toast)", async () => {
    const user = userEvent.setup();
    render(<Preview />);
    const switches = screen.getAllByRole("switch", { name: "Live feed off" });
    expect(switches).toHaveLength(2);
    await user.click(switches[0]!);
    expect(screen.getByRole("switch", { name: "Live feed on" })).toBeTruthy();
    expect(screen.getAllByRole("switch", { name: "Live feed off" })).toHaveLength(1);

    await user.click(screen.getAllByRole("button", { name: "Open dialog" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Close 2 positions?" })).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.click(screen.getAllByRole("button", { name: "Success toast" })[0]!);
    expect(await screen.findByText("Order placed")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Error toast" })[0]!);
    expect(await screen.findByText("Order rejected")).toBeTruthy();

    const expiry = screen.getAllByRole("combobox", { name: "Expiry" })[0]!;
    await user.click(expiry);
    await user.click(await screen.findByRole("option", { name: "26 Dec · 110d" }));
    expect(expiry.textContent).toContain("26 Dec");
  }, 90_000);
});

describe("[A11Y] axe smoke test on the Preview page", () => {
  it("[A11Y] has no axe violations (colour-contrast is skipped: jsdom does not compute styles)", async () => {
    const { container } = render(<Preview />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
      resultTypes: ["violations"],
    });
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary).toEqual([]);
  }, 90_000);
});

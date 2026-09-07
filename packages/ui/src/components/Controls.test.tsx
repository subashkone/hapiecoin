import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { EmptyState } from "./EmptyState";
import { Kbd } from "./Kbd";
import { Spinner } from "./Spinner";
import { Stat } from "./Stat";
import { Switch } from "./Switch";
import { Tooltip, TooltipProvider } from "./Tooltip";
import { Button } from "./Button";

describe("[UI-SWITCH] Switch", () => {
  it("[UI-SWITCH] toggles checked state on click and keyboard, reports via onCheckedChange", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Live feed" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch", { name: "Live feed" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.className).toContain("data-[state=checked]:bg-primary");
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    sw.focus();
    await user.keyboard(" ");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("[UI-SWITCH] disabled switch does not toggle", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Off" disabled defaultChecked />);
    const sw = screen.getByRole("switch");
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });
});

describe("[UI-CHECKBOX] Checkbox", () => {
  it("[UI-CHECKBOX] toggles and shows the check indicator", async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Include fees" />);
    const cb = screen.getByRole("checkbox", { name: "Include fees" });
    expect(cb.getAttribute("aria-checked")).toBe("false");
    await user.click(cb);
    expect(cb.getAttribute("aria-checked")).toBe("true");
    expect(cb.querySelector("[data-slot=checkbox-indicator] svg")).toBeTruthy();
  });

  it("[UI-CHECKBOX] indeterminate renders the minus indicator", () => {
    render(<Checkbox aria-label="Some" checked="indeterminate" />);
    const cb = screen.getByRole("checkbox");
    expect(cb.getAttribute("aria-checked")).toBe("mixed");
    expect(cb.querySelector("svg.lucide-minus")).toBeTruthy();
  });
});

describe("[UI-KBD] Kbd", () => {
  it("[UI-KBD] renders a <kbd> in mono on the muted token", () => {
    render(<Kbd>Ctrl</Kbd>);
    const k = screen.getByText("Ctrl");
    expect(k.tagName).toBe("KBD");
    expect(k.className).toContain("font-mono");
    expect(k.className).toContain("bg-muted");
  });
});

describe("[UI-TOOLTIP] Tooltip", () => {
  it("[UI-TOOLTIP] shows content on hover / focus and hides on blur", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Add a buy leg" side="bottom" align="start">
          <Button>B</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "B" });
    await user.hover(trigger);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe("Add a buy leg");
    expect(trigger.getAttribute("data-state")).toBe("delayed-open");
    await user.unhover(trigger);
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("data-state")).toBe("closed");
  });
});

describe("[UI-SPINNER] Spinner", () => {
  it("[UI-SPINNER] is a status with an accessible name and size variants", () => {
    const { rerender } = render(<Spinner />);
    const s = screen.getByRole("status", { name: "Loading" });
    expect(s.className).toContain("size-4");
    expect(s.className).toContain("border-t-primary");
    rerender(<Spinner size="lg" label="Fetching chain" />);
    expect(screen.getByRole("status", { name: "Fetching chain" }).className).toContain("size-6");
  });
});

describe("[UI-STAT] Stat", () => {
  it("[UI-STAT] renders label, mono value with tone and basis line", () => {
    render(<Stat label="Net P&L" value="+$0.18" sub="mark · USD" tone="profit" />);
    expect(screen.getByText("Net P&L").className).toContain("micro");
    const value = screen.getByText("+$0.18");
    expect(value.className).toContain("num");
    expect(value.className).toContain("text-profit");
    expect(screen.getByText("mark · USD")).toBeTruthy();
  });

  it("[UI-STAT] omits the sub line and uses the foreground tone by default", () => {
    const { container } = render(<Stat label="Spot" value="79,521.5" />);
    expect(container.querySelector("[data-slot=stat-sub]")).toBeNull();
    expect(screen.getByText("79,521.5").className).toContain("text-foreground");
  });
});

describe("[UI-EMPTY] EmptyState", () => {
  it("[UI-EMPTY] renders title, description, icon and action as a status region", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No strategy yet"
        description="Hover a chain row and press B / S"
        action={<Button size="sm">Open Builder</Button>}
      />,
    );
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("No strategy yet");
    expect(region.textContent).toContain("Hover a chain row");
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Builder" })).toBeTruthy();
  });

  it("[UI-EMPTY] renders with only a title", () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

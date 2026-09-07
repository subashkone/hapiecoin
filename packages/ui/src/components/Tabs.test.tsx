import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

function renderTabs(variant: "line" | "segmented") {
  return render(
    <Tabs defaultValue="payoff" variant={variant}>
      <TabsList aria-label="Analysis">
        <TabsTrigger value="payoff">Payoff</TabsTrigger>
        <TabsTrigger value="greeks">Greeks</TabsTrigger>
        <TabsTrigger value="vol">Vol</TabsTrigger>
      </TabsList>
      <TabsContent value="payoff">Payoff panel</TabsContent>
      <TabsContent value="greeks">Greeks panel</TabsContent>
      <TabsContent value="vol">Vol panel</TabsContent>
    </Tabs>,
  );
}

describe("[UI-TABS] Tabs (Radix)", () => {
  it("[UI-TABS] line variant underlines the active tab with the primary token", () => {
    renderTabs("line");
    const list = screen.getByRole("tablist", { name: "Analysis" });
    expect(list.className).toContain("border-b");
    const active = screen.getByRole("tab", { name: "Payoff" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.className).toContain("data-[state=active]:border-primary");
    expect(screen.getByText("Payoff panel")).toBeTruthy();
    expect(screen.queryByText("Greeks panel")).toBeNull();
  });

  it("[UI-TABS] segmented variant renders a pill group on the muted token", () => {
    renderTabs("segmented");
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("bg-muted");
    expect(screen.getByRole("tab", { name: "Payoff" }).className).toContain("data-[state=active]:bg-card");
  });

  it("[UI-TABS] arrow keys move focus and activate tabs; Home/End jump", async () => {
    const user = userEvent.setup();
    renderTabs("line");
    const payoff = screen.getByRole("tab", { name: "Payoff" });
    const greeks = screen.getByRole("tab", { name: "Greeks" });
    const vol = screen.getByRole("tab", { name: "Vol" });
    payoff.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(greeks);
    expect(greeks.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Greeks panel")).toBeTruthy();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(vol);
    expect(screen.getByText("Vol panel")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(payoff);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(vol);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(payoff);
    expect(screen.getByText("Payoff panel")).toBeTruthy();
  });

  it("[UI-TABS] clicking a tab activates it", async () => {
    const user = userEvent.setup();
    renderTabs("segmented");
    await user.click(screen.getByRole("tab", { name: "Vol" }));
    expect(screen.getByText("Vol panel")).toBeTruthy();
  });
});

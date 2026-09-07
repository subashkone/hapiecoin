import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../providers/ThemeProvider";
import { Toaster, toast } from "./Toaster";

describe("[UI-TOAST] Toaster + toast()", () => {
  it("[UI-TOAST] renders toasts with the token class names and follows the system theme outside a provider", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast.success("Order placed", { description: "C-BTC-80000-250926 · 3 lots" });
    });
    const title = await screen.findByText("Order placed");
    expect(title.className).toContain("font-medium");
    expect(screen.getByText("C-BTC-80000-250926 · 3 lots").className).toContain("text-muted-foreground");
    const li = title.closest("li");
    expect(li?.getAttribute("data-type")).toBe("success");
    expect(li?.className).toContain("bg-popover");
    expect(li?.className).toContain("border-l-primary");
    expect(container.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme")).toBeTruthy();
  });

  it("[UI-TOAST] uses the resolved theme from ThemeProvider and merges consumer classNames", async () => {
    const { container } = render(
      <ThemeProvider defaultTheme="dark">
        <Toaster toastOptions={{ classNames: { title: "custom-title" } }} />
      </ThemeProvider>,
    );
    act(() => {
      toast.error("Order rejected");
    });
    const title = await screen.findByText("Order rejected");
    expect(title.className).toContain("custom-title");
    expect(container.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme")).toBe("dark");
  });
});

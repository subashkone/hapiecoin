import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "./Button";

describe("[UI-BUTTON] Button", () => {
  it("[UI-BUTTON] renders a type=button with the primary variant and md size by default", () => {
    render(<Button>Place order</Button>);
    const btn = screen.getByRole("button", { name: "Place order" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.dataset["variant"]).toBe("primary");
    expect(btn.dataset["size"]).toBe("md");
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).toContain("text-primary-foreground");
    expect(btn.className).toContain("h-8");
  });

  it.each([
    ["secondary", "bg-secondary"],
    ["outline", "border-input"],
    ["ghost", "text-muted-foreground"],
    ["destructive", "bg-destructive"],
    ["buy", "bg-buy"],
    ["sell", "bg-sell"],
  ] as const)("[UI-BUTTON] variant %s applies the %s token class", (variant, cls) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });

  it.each([
    ["xs", "h-6"],
    ["sm", "h-7"],
    ["md", "h-8"],
    ["lg", "h-10"],
  ] as const)("[UI-BUTTON] size %s sets height %s", (size, cls) => {
    render(<Button size={size}>s</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });

  it("[UI-BUTTON] loading shows a spinner, sets aria-busy and blocks clicks", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /Saving/ });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[UI-BUTTON] iconOnly removes horizontal padding and asChild renders the child element", () => {
    render(
      <Button asChild iconOnly size="sm" variant="ghost">
        <a href="/analyse">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.className).toContain("px-0");
    expect(link.hasAttribute("type")).toBe(false);
  });

  it("[UI-BUTTON] merges consumer classes last and exposes buttonVariants", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
    expect(buttonVariants({ variant: "buy", size: "lg" })).toContain("bg-buy");
  });
});

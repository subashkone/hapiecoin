import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, badgeVariants } from "./Badge";

describe("[UI-BADGE] Badge", () => {
  it("[UI-BADGE] defaults to the primary (amber) variant in mono", () => {
    render(<Badge>PRO</Badge>);
    const el = screen.getByText("PRO");
    expect(el.dataset["variant"]).toBe("default");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("font-mono");
  });

  it.each([
    ["secondary", "bg-secondary"],
    ["outline", "border-border"],
    ["buy", "bg-buy-bg"],
    ["sell", "bg-sell-bg"],
    ["profit", "text-profit"],
    ["loss", "text-loss"],
    ["warning", "bg-warning-bg"],
    ["info", "bg-info-bg"],
  ] as const)("[UI-BADGE] variant %s applies %s", (variant, cls) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant).className).toContain(cls);
    expect(badgeVariants({ variant })).toContain(cls);
  });
});

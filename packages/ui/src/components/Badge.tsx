import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** Mono, uppercase-friendly pill. Green/red variants are only for side and P&L (ADR-003). */
export const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-transparent",
    "px-[7px] py-px font-mono text-[10.5px] font-medium leading-normal tracking-[0.04em]",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        buy: "bg-buy-bg text-buy",
        sell: "bg-sell-bg text-sell",
        profit: "bg-buy-bg text-profit",
        loss: "bg-sell-bg text-loss",
        warning: "bg-warning-bg text-warning",
        info: "bg-info-bg text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant ?? "default"}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

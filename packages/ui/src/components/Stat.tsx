import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export const statValueVariants = cva("num mt-0.5 text-[18px] font-medium leading-tight", {
  variants: {
    tone: {
      default: "text-foreground",
      profit: "text-profit",
      loss: "text-loss",
      warning: "text-warning",
      muted: "text-muted-foreground",
      spot: "text-spot",
    },
  },
  defaultVariants: { tone: "default" },
});

export interface StatProps extends ComponentProps<"div">, VariantProps<typeof statValueVariants> {
  /** Micro caption, e.g. "Net premium". */
  label: ReactNode;
  /** Already-formatted value string with its unit, e.g. "+$0.18" or "42.4 %". */
  value: ReactNode;
  /** Basis line under the value, e.g. "mark · USD". */
  sub?: ReactNode;
}

/** KPI tile: label / value / basis. Every number carries its unit and basis (frontend rule "Clarity"). */
export function Stat({ label, value, sub, tone, className, ...props }: StatProps) {
  return (
    <div
      data-slot="stat"
      className={cn("rounded-md border border-border bg-card px-3 py-2.5", className)}
      {...props}
    >
      <div data-slot="stat-label" className="micro text-[10px]">
        {label}
      </div>
      <div data-slot="stat-value" className={statValueVariants({ tone })}>
        {value}
      </div>
      {sub !== undefined ? (
        <div data-slot="stat-sub" className="text-2xs text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

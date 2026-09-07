import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const spinnerVariants = cva(
  "inline-block shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin motion-reduce:animate-none",
  {
    variants: {
      size: {
        sm: "size-3 border-[1.5px]",
        md: "size-4",
        lg: "size-6",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface SpinnerProps extends ComponentProps<"span">, VariantProps<typeof spinnerVariants> {
  /** Accessible name; defaults to "Loading". */
  label?: string;
}

/** Indeterminate progress indicator (amber ring, matches the mock's `.spinner`). */
export function Spinner({ className, size, label = "Loading", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      data-slot="spinner"
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  );
}

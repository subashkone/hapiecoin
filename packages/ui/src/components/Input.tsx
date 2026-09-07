import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** Shared control chrome for Input, Textarea and the Select trigger. */
export const controlVariants = cva(
  [
    "flex w-full rounded border border-input bg-background text-foreground",
    "placeholder:text-muted-foreground outline-none transition-[border-color,box-shadow]",
    "focus:border-ring focus:ring-2 focus:ring-ring/22 focus-visible:outline-none",
    "disabled:opacity-45 disabled:cursor-not-allowed",
    "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/22",
  ],
  {
    variants: {
      size: {
        sm: "h-7 px-2 text-xs",
        md: "h-8 px-2.5 text-[12.5px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface InputProps
  extends Omit<ComponentProps<"input">, "size">, VariantProps<typeof controlVariants> {
  /** Right-aligned tabular figures (DM Mono) for prices, quantities and greeks. */
  numeric?: boolean;
}

export function Input({ className, size, numeric = false, type = "text", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      inputMode={numeric && type === "text" ? "decimal" : undefined}
      className={cn(controlVariants({ size }), numeric && "num text-right", className)}
      {...props}
    />
  );
}

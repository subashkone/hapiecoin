import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

/**
 * Button variants. Amber `primary` is reserved for the main action of a screen; `buy`/`sell` only for
 * order side (ADR-003). `text-white` on buy/sell mirrors the mock (white text on green/red in both themes).
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none rounded",
    "border border-transparent font-medium leading-none transition-colors",
    "disabled:opacity-45 disabled:cursor-not-allowed aria-busy:cursor-progress",
    "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground font-semibold hover:brightness-[1.08]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-surface-3",
        outline: "bg-transparent border-input text-foreground hover:bg-muted",
        ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-[1.08]",
        buy: "bg-buy text-white font-semibold hover:brightness-[1.08]",
        sell: "bg-sell text-white font-semibold hover:brightness-[1.08]",
      },
      size: {
        xs: "h-6 px-2 text-2xs",
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-[12.5px]",
        lg: "h-10 px-[18px] text-[14px]",
      },
      iconOnly: {
        true: "px-0 aspect-square",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button> (Radix Slot), e.g. a Next.js Link. */
  asChild?: boolean;
  /** Shows a spinner, sets `aria-busy` and disables the button. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  iconOnly,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled === true || loading;
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-size={size ?? "md"}
      className={cn(buttonVariants({ variant, size, iconOnly }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size="sm" className="border-current/30 border-t-current" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

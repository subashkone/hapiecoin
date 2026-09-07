import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentProps } from "react";
import { Check, Minus } from "../icons";
import { cn } from "../lib/cn";

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

/** Tri-state checkbox (`checked` may be `"indeterminate"`). Always give it an accessible name. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-[15px] shrink-0 items-center justify-center rounded-sm border border-input bg-background",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:text-primary",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center"
      >
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

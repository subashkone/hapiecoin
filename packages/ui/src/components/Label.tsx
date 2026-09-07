import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type LabelProps = ComponentProps<typeof LabelPrimitive.Root>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "block text-[11.5px] font-medium tracking-[0.02em] text-muted-foreground select-none",
        "peer-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

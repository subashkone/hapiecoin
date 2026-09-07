import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type KbdProps = ComponentProps<"kbd">;

/** Keyboard key hint, e.g. <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>. */
export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-block rounded-sm border border-input bg-muted px-[5px] py-px font-mono text-[10px] leading-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

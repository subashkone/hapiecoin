import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/** Mount once near the app root (Preview does it for you). */
export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-110 max-w-xs rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground",
          "shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export interface TooltipProps extends Omit<ComponentProps<typeof TooltipPrimitive.Root>, "children"> {
  /** Tooltip text or node. */
  content: ReactNode;
  /** The trigger element; it must accept a ref and forward props (Radix `asChild`). */
  children: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: ComponentProps<typeof TooltipPrimitive.Content>["align"];
}

/** `<Tooltip content="Add leg"><Button>…</Button></Tooltip>`; requires a TooltipProvider above. */
export function Tooltip({ content, children, side, align, ...root }: TooltipProps) {
  return (
    <TooltipRoot {...root}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent {...(side ? { side } : {})} {...(align ? { align } : {})}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}

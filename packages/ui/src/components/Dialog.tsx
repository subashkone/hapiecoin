import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { X } from "../icons";
import { cn } from "../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-100 bg-black/70",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export const dialogContentVariants = cva(
  [
    "fixed left-1/2 top-1/2 z-100 flex w-[calc(100%-40px)] -translate-x-1/2 -translate-y-1/2 flex-col",
    "max-h-[92vh] overflow-auto rounded-lg border border-input bg-card text-card-foreground",
    "shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none",
  ],
  {
    variants: {
      size: {
        sm: "max-w-[420px]",
        md: "max-w-[520px]",
        lg: "max-w-[860px]",
        xl: "max-w-[1100px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface DialogContentProps
  extends ComponentProps<typeof DialogPrimitive.Content>, VariantProps<typeof dialogContentVariants> {
  /** Hide the top-right close button (e.g. for confirmation dialogs that must be answered). */
  hideClose?: boolean;
}

/**
 * Dialog surface with overlay. Compose: DialogHeader(DialogTitle, DialogDescription) + DialogBody + DialogFooter.
 * A DialogTitle is required for accessibility (Radix warns otherwise).
 */
export function DialogContent({
  className,
  size,
  hideClose = false,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size ?? "md"}
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              "absolute right-3 top-3 grid size-[26px] place-items-center rounded-sm text-muted-foreground",
              "hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-0.5 px-5 pt-4 pb-1.5 pr-12", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-display text-[16px] font-semibold leading-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("px-5 pt-2.5 pb-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 px-5 pt-2.5 pb-4 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

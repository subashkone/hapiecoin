import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { controlVariants } from "./Input";

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlVariants({ size: "md" }), "h-auto min-h-[84px] resize-y px-2.5 py-2", className)}
      {...props}
    />
  );
}

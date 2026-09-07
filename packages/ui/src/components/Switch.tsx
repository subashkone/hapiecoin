import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>;

/** On/off toggle; amber track when on (mock `.switch.on`). Always give it an accessible name. */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full bg-input transition-colors",
        "data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "block size-3.5 rounded-full bg-foreground transition-transform translate-x-[3px]",
          "data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-primary-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { createContext, useContext, type ComponentProps } from "react";
import { cn } from "../lib/cn";

export type TabsVariant = "line" | "segmented";

const TabsVariantContext = createContext<TabsVariant>("line");

export interface TabsProps extends ComponentProps<typeof TabsPrimitive.Root> {
  /** `line`: underline tabs (page sections). `segmented`: pill group (small toggles like Payoff / Greeks). */
  variant?: TabsVariant;
}

export function Tabs({ variant = "line", className, ...props }: TabsProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-variant={variant}
        className={cn("flex flex-col gap-3", className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        variant === "segmented"
          ? "inline-flex w-fit gap-0.5 rounded border border-border bg-muted p-0.5"
          : "flex min-w-0 gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium text-muted-foreground transition-colors",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        variant === "segmented"
          ? "rounded-sm px-[11px] py-[5px] data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0_0_1px_hsl(var(--border))]"
          : "px-[11px] py-2 focus-visible:-outline-offset-2 data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none focus-visible:outline-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}

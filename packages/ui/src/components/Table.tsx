import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export interface TableProps extends ComponentProps<"table"> {
  /** Tighter padding and 12px text for dense panels; row height still follows `--row-h`. */
  compact?: boolean;
  /** Class for the scrolling wrapper. */
  wrapperClassName?: string;
}

/** Data table primitives. Rows are `h-row` tall (36px comfortable / 28px compact via DensityProvider). */
export function Table({ className, compact = false, wrapperClassName, ...props }: TableProps) {
  return (
    <div data-slot="table-wrapper" className={cn("relative w-full overflow-x-auto", wrapperClassName)}>
      <table
        data-slot="table"
        data-compact={compact || undefined}
        className={cn(
          "w-full border-collapse text-[12.5px]",
          compact && "text-xs [&_td]:px-2 [&_th]:px-2",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="thead" className={cn("[&_tr]:hover:bg-transparent", className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="tbody" className={cn(className)} {...props} />;
}

export function TFoot({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot data-slot="tfoot" className={cn("border-t border-border font-medium", className)} {...props} />
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="tr"
      className={cn(
        "h-row border-b border-border transition-colors hover:bg-muted/60 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export interface CellProps {
  /** Right-aligned tabular figures (DM Mono). Use for every price, size, greek and percentage. */
  numeric?: boolean;
}

export function Th({ className, numeric = false, ...props }: ComponentProps<"th"> & CellProps) {
  return (
    <th
      data-slot="th"
      className={cn(
        "micro h-8 px-2.5 text-left align-middle whitespace-nowrap font-medium tracking-[0.08em]",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, numeric = false, ...props }: ComponentProps<"td"> & CellProps) {
  return (
    <td
      data-slot="td"
      className={cn("px-2.5 py-0 align-middle", numeric && "num text-right", className)}
      {...props}
    />
  );
}

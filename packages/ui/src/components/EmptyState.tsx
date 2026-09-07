import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  /** Short statement of what is missing, e.g. "No strategy yet". */
  title: ReactNode;
  /** What to do next, e.g. "Hover a chain row and press B / S". */
  description?: ReactNode;
  icon?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
}

/** Designed empty state (frontend rule: empty and error states are designed, not blank). */
export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      role="status"
      className={cn(
        "flex flex-col items-center px-4 py-8 text-center text-[12.5px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="mb-2 text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="mb-1 text-[14px] font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

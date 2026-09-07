import { Toaster as SonnerToaster, toast, type ToasterProps as SonnerToasterProps } from "sonner";
import { useOptionalTheme } from "../providers/ThemeProvider";

export type ToasterProps = SonnerToasterProps;

/**
 * Themed sonner toaster. Mount once; call `toast("Order placed")`, `toast.success(...)`, `toast.error(...)`.
 * Follows ThemeProvider when present, otherwise the system theme.
 */
export function Toaster({ toastOptions, ...props }: ToasterProps) {
  const theme = useOptionalTheme();
  return (
    <SonnerToaster
      theme={theme?.resolvedTheme ?? "system"}
      position="bottom-right"
      offset={{ bottom: 56, right: 16 }}
      gap={8}
      toastOptions={{
        unstyled: true,
        ...toastOptions,
        classNames: {
          toast:
            "group flex w-[360px] items-start gap-2.5 rounded-md border border-input border-l-[3px] border-l-primary bg-popover px-3 py-2.5 text-[12.5px] text-popover-foreground shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] data-[type=error]:border-l-destructive data-[type=success]:border-l-profit data-[type=warning]:border-l-warning data-[type=info]:border-l-info",
          title: "font-medium",
          description: "text-[11.5px] text-muted-foreground",
          icon: "mt-px shrink-0 [&_svg]:size-4 group-data-[type=error]:text-destructive group-data-[type=success]:text-profit group-data-[type=warning]:text-warning group-data-[type=info]:text-info",
          actionButton:
            "ml-auto h-6 shrink-0 rounded-sm bg-primary px-2 text-2xs font-semibold text-primary-foreground",
          cancelButton: "ml-auto h-6 shrink-0 rounded-sm bg-muted px-2 text-2xs text-muted-foreground",
          closeButton: "text-muted-foreground hover:text-foreground",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

export { toast };

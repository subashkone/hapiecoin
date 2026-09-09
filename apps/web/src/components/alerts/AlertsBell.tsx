"use client";
// Header bell (HC-SH-079): the armed count as a badge, red once an alert has triggered; opens the Alerts center.
import { alertCounts } from "@hapiecoin/schema";
import { Bell, Button, cn } from "@hapiecoin/ui";
import { useAlerts } from "@/lib/api/alerts";
import { useUiStore } from "@/lib/store";

export function AlertsBell({ className }: { className?: string }) {
  const { data } = useAlerts();
  const counts = alertCounts(data ?? []);
  const openAlerts = useUiStore((s) => s.openAlerts);
  const shown = counts.triggered || counts.armed;
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      title="Alerts"
      aria-label={`Alerts · ${counts.armed} armed${counts.triggered ? ` · ${counts.triggered} triggered` : ""}`}
      className={cn("relative", className)}
      onClick={() => openAlerts()}
      data-testid="alerts-bell"
      data-armed={counts.armed}
      data-triggered={counts.triggered}
    >
      <Bell className="size-4" aria-hidden="true" />
      {shown > 0 ? (
        <span className={cn("absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full px-1 text-center font-mono text-[9px] leading-[14px]", counts.triggered ? "bg-loss text-white" : "bg-primary text-primary-foreground")} data-testid="alerts-badge">
          {shown}
        </span>
      ) : null}
    </Button>
  );
}

"use client";
// Column Settings (HC-WS-010..014, HC-WS-073): Show / Hide tab with grouped switches and a live counter,
// quick buttons, and a Reorder tab (▲ ▼ plus drag). Every change applies to the chain immediately and is
// persisted by the UI store; nothing here touches server state. Design: docs/design/options-chain.md § Item 2.
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@hapiecoin/ui";
import { useState } from "react";
import { COLUMNS, COLUMN_GROUPS, OHLC_PLACEHOLDER, columnById } from "@/components/chain/columns";
import { type LayoutColumnId, type LayoutPreset, applyPreset, greeksShown, moveColumn, moveColumnTo, setGreeks, toggleColumn } from "@/lib/chain/layout";
import { useUiStore } from "@/lib/store";
import type { DialogProps } from "./SettingsDialogs";

const PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: "essentials", label: "Essentials" },
  { id: "all", label: "Show all" },
  { id: "none", label: "Hide all" },
  { id: "reset", label: "Reset" },
];

export function ColumnSettingsDialog({ open, onOpenChange }: DialogProps) {
  const layout = useUiStore((s) => s.chainColumns);
  const setLayout = useUiStore((s) => s.setChainColumns);
  const [dragId, setDragId] = useState<LayoutColumnId | null>(null);
  const shown = layout.visible.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="column-settings">
        <DialogHeader>
          <DialogTitle>Column Settings</DialogTitle>
          <DialogDescription data-testid="columns-counter">
            {shown} of {COLUMNS.length} columns visible
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Tabs defaultValue="show" className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="show" data-testid="columns-tab-show">
                  Show / Hide
                </TabsTrigger>
                <TabsTrigger value="reorder" data-testid="columns-tab-reorder">
                  Reorder
                </TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Quick presets">
                {PRESETS.map((p) => (
                  <Button key={p.id} size="sm" variant="ghost" onClick={() => setLayout(applyPreset(layout, p.id))} data-testid={`columns-preset-${p.id}`}>
                    {p.label}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setLayout(setGreeks(layout, !greeksShown(layout)))} data-testid="columns-greeks" aria-pressed={greeksShown(layout)}>
                  {greeksShown(layout) ? "Hide Greeks" : "Show Greeks"}
                </Button>
              </div>
            </div>
            <TabsContent value="show" className="max-h-[56vh] overflow-auto">
              {COLUMN_GROUPS.map((group) => (
                <div key={group} className="mb-3" data-testid={`columns-group-${group.replace(/\s+/g, "-").toLowerCase()}`}>
                  <div className="micro mb-0.5">{group}</div>
                  <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {COLUMNS.filter((c) => c.group === group).map((c) => {
                      const on = layout.visible.includes(c.id);
                      const id = `col-${c.id}`;
                      return (
                        <label key={c.id} htmlFor={id} className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-[12.5px] hover:bg-muted" data-testid={`columns-row-${c.id}`} data-on={on}>
                          <span title={c.title}>{c.label}</span>
                          <Switch id={id} checked={on} onCheckedChange={() => setLayout(toggleColumn(layout, c.id))} aria-label={c.label} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="mb-1 opacity-60" data-testid="columns-group-ohlc">
                <div className="micro mb-0.5">{OHLC_PLACEHOLDER.group}</div>
                <div className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
                  {OHLC_PLACEHOLDER.labels.join(" · ")} — {OHLC_PLACEHOLDER.note}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="reorder" className="max-h-[56vh] overflow-auto">
              <p className="mb-2 text-xs text-muted-foreground">
                Drag columns to change their display order (left → right). The order applies from the strike outward and is mirrored on the Calls side.
              </p>
              <ol className="flex flex-col gap-1" data-testid="columns-order">
                {layout.order.map((id, i) => {
                  const c = columnById(id);
                  const hidden = !layout.visible.includes(id);
                  return (
                    <li
                      key={id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (dragId && dragId !== id) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId && dragId !== id) setLayout(moveColumnTo(layout, dragId, id));
                        setDragId(null);
                      }}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        "flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5 text-[12.5px]",
                        dragId === id && "opacity-40",
                      )}
                      data-testid={`columns-order-${id}`}
                      data-index={i}
                    >
                      <span className="w-5 font-mono text-3xs text-muted-foreground">{i + 1}</span>
                      <span className="cursor-grab text-muted-foreground" aria-hidden>
                        ⋮⋮
                      </span>
                      <span className="flex-1">{c.label}</span>
                      {hidden ? <span className="micro rounded border border-border px-1">hidden</span> : null}
                      <Button size="sm" variant="ghost" aria-label={`Move ${c.label} towards the strike`} disabled={i === 0} onClick={() => setLayout(moveColumn(layout, id, -1))} data-testid={`columns-up-${id}`}>
                        ▲
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Move ${c.label} away from the strike`} disabled={i === layout.order.length - 1} onClick={() => setLayout(moveColumn(layout, id, 1))} data-testid={`columns-down-${id}`}>
                        ▼
                      </Button>
                    </li>
                  );
                })}
              </ol>
            </TabsContent>
          </Tabs>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="columns-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

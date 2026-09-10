"use client";
// Keyboard shortcuts help (HC-SH-102, 103; HC-WS-070): every row of the registry grouped Global / Analyse workspace /
// other, opened with "?" anywhere outside a field, from the settings menu or the palette.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Kbd } from "@hapiecoin/ui";
import { useSyncExternalStore } from "react";
import { DEFAULT_SHORTCUTS, listShortcuts, subscribeShortcuts, type ShortcutRow } from "@/lib/shortcuts";
import type { DialogProps } from "./SettingsDialogs";

function groupsOf(rows: readonly ShortcutRow[]): [string, ShortcutRow[]][] {
  const order = ["Global", "Analyse workspace"];
  const by = new Map<string, ShortcutRow[]>();
  for (const r of rows) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  return [...by.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
}

/** "Shift+E" → two keycaps; "Ctrl K" → two keycaps; "?" → one. */
function Keys({ combo }: { combo: string }) {
  const parts = combo.split(/\+| /).filter(Boolean);
  return (
    <span className="inline-flex gap-1">
      {parts.map((p, i) => (
        <Kbd key={`${p}-${i}`}>{p}</Kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: DialogProps) {
  const rows = useSyncExternalStore(subscribeShortcuts, listShortcuts, () => DEFAULT_SHORTCUTS);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? anywhere (outside a field) to open this list</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-auto">
          {groupsOf(rows).map(([group, list]) => (
            <section key={group} data-testid="shortcuts-group" data-group={group}>
              <h3 className="micro mb-1">{group}</h3>
              <table className="w-full text-xs">
                <tbody>
                  {list.map((r) => (
                    <tr key={`${group}-${r.key}`} className="border-b border-border last:border-0" data-testid="shortcut-row">
                      <td className="w-[120px] py-1.5 pr-3 align-top"><Keys combo={r.key} /></td>
                      <td className="py-1.5">{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <p className="text-2xs text-muted-foreground">Shortcuts are ignored while typing in a field or when a dialog is open (except Ctrl K and Esc).</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

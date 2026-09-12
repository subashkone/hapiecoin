"use client";
// Public page settings (ADR-075; HC-SH-127): choose a handle, switch the page on, pick what it shows, then share it.
// Off by default; the page shows totals net of fees always and the daily chart, accounts and months only when ticked.
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ExternalLink,
  Field,
  Input,
  Switch,
  toast,
} from "@hapiecoin/ui";
import { Handle, type PublicPageSettings } from "@hapiecoin/schema";
import { useEffect, useState } from "react";
import { usePublicPageSettings, usePublicTrader, useUpdatePublicPage } from "@/lib/api/public-page";
import { USD } from "@/lib/money";
import { pageUrl } from "@/lib/public/share";
import { ShareBar } from "@/components/public/ShareBar";
import type { DialogProps } from "./SettingsDialogs";

export function PublicPageDialog({ open, onOpenChange }: DialogProps) {
  const { data: saved } = usePublicPageSettings(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="public-dialog">
        <DialogHeader>
          <DialogTitle>Public page</DialogTitle>
          <DialogDescription>Your verified P&amp;L on a page anyone can open, at your handle</DialogDescription>
        </DialogHeader>
        {saved ? <PublicPageForm saved={saved} onClose={() => onOpenChange(false)} /> : <DialogBody>Loading…</DialogBody>}
      </DialogContent>
    </Dialog>
  );
}

const SHOW: { key: "showDays" | "showAccounts" | "showMonths"; label: string; hint: string }[] = [
  { key: "showDays", label: "Daily chart", hint: "realised per day, net of fees" },
  { key: "showAccounts", label: "Accounts", hint: "each account by its label and figure; never balances or positions" },
  { key: "showMonths", label: "Monthly table", hint: "realised per month" },
];

export function PublicPageForm({ saved, onClose }: { saved: PublicPageSettings; onClose: () => void }) {
  const update = useUpdatePublicPage();
  const [form, setForm] = useState<PublicPageSettings>(saved);
  useEffect(() => setForm(saved), [saved]);
  const handle = (form.handle ?? "").trim().toLowerCase();
  const handleOk = handle !== "" && Handle.safeParse(handle).success;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const live = saved.enabled && saved.handle !== null;
  const trader = usePublicTrader(saved.handle ?? "", live);
  const liveTrader = live ? trader.data : undefined;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const renaming = saved.handle !== null && handle !== "" && handle !== saved.handle;

  const save = () => {
    if (form.enabled && !handleOk) {
      toast.error("Choose a handle first", { description: "3–20 letters, digits or underscores" });
      return;
    }
    if (handle !== "" && !handleOk) {
      toast.error("That handle will not work", { description: Handle.safeParse(handle).error?.issues[0]?.message ?? "3–20 letters, digits or underscores" });
      return;
    }
    update.mutate(
      { ...form, handle: handle === "" ? null : handle },
      {
        onSuccess: (s) => toast(s.enabled ? "Public page is on" : "Public page saved", { description: s.enabled && s.handle ? pageUrl(origin, s.handle) : "The page stays off until you switch it on" }),
        onError: (e) => toast.error("Could not save", { description: e.message }),
      },
    );
  };

  return (
    <>
      <DialogBody className="space-y-3 text-xs">
        <Field label="Handle" hint="3–20 letters, digits or underscores; the page lives at /t/<handle>">
          {(control) => (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{origin.replace(/^https?:\/\//, "") || "hapiecoin.com"}/t/</span>
              <Input {...control} value={form.handle ?? ""} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="your_handle" className="font-mono" maxLength={20} data-testid="public-handle" />
            </div>
          )}
        </Field>
        {renaming ? <p className="text-warning" data-testid="public-rename-note">Changing the handle breaks links you already shared.</p> : null}
        <label className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
          <span>
            <span className="block font-medium">Page is {form.enabled ? "on" : "off"}</span>
            <span className="text-muted-foreground">Off: nobody can open it. On: anyone with the link sees your totals net of fees, fill count and since when.</span>
          </span>
          <Switch checked={form.enabled} onCheckedChange={(on) => setForm({ ...form, enabled: on })} disabled={!handleOk && !form.enabled} aria-label="Public page on" data-testid="public-enabled" />
        </label>
        <div className="space-y-1.5">
          <div className="micro">Also show</div>
          {SHOW.map((s) => (
            <label key={s.key} className="flex items-center gap-2">
              <Checkbox checked={form[s.key]} onCheckedChange={(v) => setForm({ ...form, [s.key]: v === true })} aria-label={s.label} data-testid={`public-${s.key}`} />
              <span>
                {s.label} <span className="text-muted-foreground">· {s.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {live && saved.handle ? (
          <div className="space-y-2 rounded border border-accent/40 p-2" data-testid="public-live">
            <div className="flex items-center gap-2">
              <input readOnly value={pageUrl(origin, saved.handle)} onFocus={(e) => e.currentTarget.select()} className="num h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-2xs" aria-label="Public page link" data-testid="public-link" />
              <Button size="sm" variant="outline" asChild>
                <a href={pageUrl(origin, saved.handle)} target="_blank" rel="noopener noreferrer" data-testid="public-open">
                  Open <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </Button>
            </div>
            {liveTrader ? <ShareBar page={liveTrader} url={pageUrl(origin, saved.handle)} money={USD} compact /> : <p className="text-muted-foreground">{trader.isError ? "The page could not be read yet." : "Reading your page…"}</p>}
          </div>
        ) : (
          <p className="text-muted-foreground" data-testid="public-off-note">
            {saved.handle ? "Switch the page on and save to get your link and the share buttons." : "Choose a handle and save; then switch the page on."}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={save} loading={update.isPending} disabled={!dirty && !update.isPending} data-testid="public-save">
          {update.isPending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}


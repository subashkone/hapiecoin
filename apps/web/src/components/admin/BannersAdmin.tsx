"use client";
// Admin · Banner Master (HC-AD-059..070, 121, 122; ADR-033; docs/design/admin.md §4b): schedule promotional popups,
// see which are showing now, switch, edit, delete, and preview one exactly as a trader sees it.
import { BANNER_FREQUENCY_LABELS, BANNER_IMAGE_MAX_BYTES, type Banner, type BannerCreate, type BannerFrequency, type BannerPatch, type BannerSchedule } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Monitor, Pencil, Switch, Trash, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { AdminHeader } from "./AdminShell";
import { FlyerDialog } from "../shell/FlyerPopup";
import { type ColumnDef, copyCsv } from "./table-tools";
import { checkImageFile, fmtBytes, readAsDataUrl, useAdminBanners, useCreateBanner, useDeleteBanner, useUpdateBanner } from "@/lib/api/banners";
import { fmtDate } from "@/lib/format";

const SCHEDULE_LABELS: Record<BannerSchedule, string> = { showing: "Showing now", scheduled: "Scheduled", ended: "Ended", hidden: "Hidden" };
const inputClass = "h-8 w-full rounded border border-input bg-background px-2 text-xs";
const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : null);
const windowText = (b: Banner) => (b.startsAt || b.endsAt ? `${b.startsAt ? fmtDate(b.startsAt) : "…"} → ${b.endsAt ? fmtDate(b.endsAt) : "…"}` : "Always");

const COLUMNS: ColumnDef<Banner>[] = [
  { key: "title", label: "Title", csv: (b) => b.title },
  { key: "description", label: "Description", csv: (b) => b.description },
  { key: "linkUrl", label: "Link", csv: (b) => b.linkUrl ?? "" },
  { key: "frequency", label: "Frequency", csv: (b) => BANNER_FREQUENCY_LABELS[b.frequency] },
  { key: "startsAt", label: "Starts", csv: (b) => b.startsAt ?? "" },
  { key: "endsAt", label: "Ends", csv: (b) => b.endsAt ?? "" },
  { key: "schedule", label: "Schedule", csv: (b) => SCHEDULE_LABELS[b.schedule] },
  { key: "active", label: "Active", csv: (b) => (b.active ? "yes" : "no") },
];

interface Form { title: string; description: string; linkUrl: string; frequency: BannerFrequency; startsAt: string; endsAt: string; active: boolean; image: string | null; imageName: string }
const emptyForm = (): Form => ({ title: "", description: "", linkUrl: "", frequency: "once_per_day", startsAt: "", endsAt: "", active: true, image: null, imageName: "" });
const formOf = (b: Banner): Form => ({ title: b.title, description: b.description, linkUrl: b.linkUrl ?? "", frequency: b.frequency, startsAt: toLocalInput(b.startsAt), endsAt: toLocalInput(b.endsAt), active: b.active, image: null, imageName: "" });

function BannerDialog({ banner, onOpenChange }: { banner: Banner | null; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<Form>(banner ? formOf(banner) : emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const create = useCreateBanner();
  const update = useUpdateBanner();
  const busy = create.isPending || update.isPending;
  const previewSrc = form.image ?? banner?.imageUrl ?? null;
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const bad = checkImageFile(file);
    if (bad) {
      setError(bad);
      toast.error("Invalid image", { description: bad });
      return;
    }
    setError(null);
    setForm((f) => ({ ...f, imageName: file.name }));
    setForm((f) => ({ ...f, image: null }));
    const data = await readAsDataUrl(file);
    setForm((f) => ({ ...f, image: data }));
  };
  const validate = (): string | null => {
    if (!form.title.trim()) return "Title is required";
    if (!banner && !form.image) return "Image is required";
    if (form.linkUrl && !/^https?:\/\//i.test(form.linkUrl.trim())) return "Link must start with http:// or https://";
    if (form.startsAt && form.endsAt && new Date(`${form.endsAt}:00Z`).getTime() <= new Date(`${form.startsAt}:00Z`).getTime()) return "End must be after start";
    return null;
  };
  const submit = () => {
    const bad = validate();
    if (bad) {
      setError(bad);
      toast.error("Validation", { description: bad });
      return;
    }
    setError(null);
    const common = { title: form.title.trim(), description: form.description.trim(), linkUrl: form.linkUrl.trim() || null, frequency: form.frequency, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), active: form.active };
    const fail = (e: Error) => { setError(e.message); toast.error("Failed to save", { description: e.message }); };
    if (banner) {
      const body: BannerPatch = { ...common, ...(form.image ? { image: form.image } : {}) };
      update.mutate({ id: banner.id, body }, { onSuccess: () => { toast.success("Updated", { description: common.title }); onOpenChange(false); }, onError: fail });
    } else {
      const body: BannerCreate = { ...common, image: form.image! };
      create.mutate(body, { onSuccess: () => { toast.success("Created", { description: common.title }); onOpenChange(false); }, onError: fail });
    }
  };
  const previewBanner: Banner = { id: banner?.id ?? "preview", title: form.title || "Untitled banner", description: form.description, linkUrl: form.linkUrl.trim() || null, type: "popup", frequency: form.frequency, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), active: form.active, imageUrl: previewSrc ?? "", imageType: "", imageBytes: 0, schedule: "showing", createdAt: "", updatedAt: "" };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="banner-dialog">
        <DialogHeader>
          <DialogTitle>{banner ? "Edit Banner" : "New Banner"}</DialogTitle>
          <DialogDescription>{banner ? "Change any field; leave the image empty to keep the current one." : "A popup traders see on Analyse at the frequency you choose."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <label className="block"><span className="micro">Title *</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} placeholder="Welcome Offer" data-testid="banner-title" /></label>
          <label className="block"><span className="micro">Description</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full rounded border border-input bg-background px-2 py-1 text-xs" placeholder="Get 20% off your first plan" data-testid="banner-description" /></label>
          <label className="block"><span className="micro">Link URL (optional)</span><input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} className={`num ${inputClass}`} placeholder="https://hapiecoin.com/subscription" data-testid="banner-link" /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="micro">Frequency</span>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as BannerFrequency })} className={inputClass} aria-label="Frequency" data-testid="banner-frequency">
                {(Object.keys(BANNER_FREQUENCY_LABELS) as BannerFrequency[]).map((k) => <option key={k} value={k}>{BANNER_FREQUENCY_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="block"><span className="micro">Starts (UTC)</span><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={`num ${inputClass}`} data-testid="banner-starts" /></label>
            <label className="block"><span className="micro">Ends (UTC)</span><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={`num ${inputClass}`} data-testid="banner-ends" /></label>
          </div>
          <div>
            <span className="micro">Image {banner ? "(leave empty to keep current)" : "*"} · PNG, JPEG, WebP or GIF · maximum size {fmtBytes(BANNER_IMAGE_MAX_BYTES)} · 1200×630 recommended</span>
            <input type="file" accept="image/*" onChange={(e) => void pickFile(e.target.files?.[0])} className="mt-1 block w-full text-xs" aria-label="Banner image" data-testid="banner-image" />
            {previewSrc ? <img src={previewSrc} alt="" className="mt-2 aspect-[1200/630] w-full rounded border border-border object-cover" data-testid="banner-preview-img" /> : null}
            {form.imageName ? <span className="micro">{form.imageName}</span> : null}
          </div>
          <label className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(on) => setForm({ ...form, active: on })} aria-label="Active" data-testid="banner-active" /> Active</label>
          {error ? <p className="text-loss" role="alert" data-testid="banner-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPreview(true)} data-testid="banner-preview">Preview as user</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={submit} data-testid="banner-save">{banner ? "Save Changes" : "Create Banner"}</Button>
        </DialogFooter>
      </DialogContent>
      {preview ? <FlyerDialog banners={[previewBanner]} preview onClose={() => setPreview(false)} /> : null}
    </Dialog>
  );
}

export function BannersAdmin() {
  const banners = useAdminBanners();
  const update = useUpdateBanner();
  const remove = useDeleteBanner();
  const [q, setQ] = useState("");
  const [schedule, setSchedule] = useState<"all" | BannerSchedule | "active" | "inactive">("all");
  const [frequency, setFrequency] = useState<"all" | BannerFrequency>("all");
  const [editing, setEditing] = useState<Banner | null | "new">(null);
  const [previewing, setPreviewing] = useState<Banner | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);
  const all = useMemo(() => banners.data ?? [], [banners.data]);
  const rows = all.filter((b) => (!q || `${b.title} ${b.description}`.toLowerCase().includes(q.toLowerCase())) && (schedule === "all" || (schedule === "active" ? b.active : schedule === "inactive" ? !b.active : b.schedule === schedule)) && (frequency === "all" || b.frequency === frequency));
  const filtered = q !== "" || schedule !== "all" || frequency !== "all";
  const clear = () => { setQ(""); setSchedule("all"); setFrequency("all"); };
  const toggle = (b: Banner, on: boolean) => update.mutate({ id: b.id, body: { active: on } }, { onSuccess: () => toast.success("Updated", { description: `${b.title} · ${on ? "active" : "inactive"}` }), onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-banners" data-count={all.length} data-state={banners.isLoading ? "loading" : banners.isError ? "error" : "ready"}>
      <AdminHeader title="Banner Master" subtitle="Promotional popups traders see on Analyse, at the frequency you choose" action={<Button size="sm" onClick={() => setEditing("new")} data-testid="banner-new">+ New Banner</Button>} />
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2" data-testid="banner-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banners" className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search banners" data-testid="banner-search" />
        <select value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Schedule" data-testid="banner-schedule-filter">
          <option value="all">All</option>
          <option value="showing">Showing now</option>
          <option value="scheduled">Scheduled</option>
          <option value="ended">Ended</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Frequency" data-testid="banner-frequency-filter">
          <option value="all">All frequencies</option>
          {(Object.keys(BANNER_FREQUENCY_LABELS) as BannerFrequency[]).map((k) => <option key={k} value={k}>{BANNER_FREQUENCY_LABELS[k]}</option>)}
        </select>
        {filtered ? <Button size="sm" variant="ghost" onClick={clear} data-testid="banner-clear">Clear</Button> : null}
        <span className="flex-1" />
        <span className="micro">{rows.length} of {all.length}</span>
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copyCsv(rows, COLUMNS, "banners")} data-testid="banner-csv">Copy CSV</Button>
      </div>
      {banners.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : banners.isError ? (
        <EmptyState title="Couldn't load banners" description={banners.error.message} className="py-10" action={<Button size="sm" onClick={() => void banners.refetch()}>Retry</Button>} data-testid="banner-load-error" />
      ) : all.length === 0 ? (
        <EmptyState title="No Banners" description="Create your first banner" className="py-10" action={<Button size="sm" onClick={() => setEditing("new")}>+ Create Banner</Button>} data-testid="banner-empty" />
      ) : rows.length === 0 ? (
        <EmptyState title="No banners match" description="Try another search, schedule or frequency" className="py-10" action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} data-testid="banner-empty-filtered" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="banner-table">
            <thead><tr className="micro text-left"><th className="py-1 pl-2 pr-2">Image</th><th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Frequency</th><th className="py-1 pr-2">Window</th><th className="py-1 pr-2">Schedule</th><th className="py-1 pr-2">Active</th><th className="py-1 pr-2 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={cn("border-t border-border", !b.active && "opacity-70")} data-testid="banner-row" data-title={b.title} data-schedule={b.schedule}>
                  <td className="py-1 pl-2 pr-2"><img src={b.imageUrl} alt="" className="h-[34px] w-[64px] rounded border border-border object-cover" data-testid="banner-thumb" /></td>
                  <td className="max-w-[320px] py-1 pr-2"><div className="truncate font-medium" title={b.title}>{b.title}</div><div className="micro truncate">{b.description}{b.linkUrl ? ` · ${b.linkUrl}` : ""}</div><div className="micro">{fmtBytes(b.imageBytes)} · {b.imageType.replace("image/", "")}</div></td>
                  <td className="py-1 pr-2">{BANNER_FREQUENCY_LABELS[b.frequency]}</td>
                  <td className="num py-1 pr-2">{windowText(b)}</td>
                  <td className="py-1 pr-2"><span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", b.schedule === "showing" ? "border-profit/60 text-profit" : "border-border text-muted-foreground")} data-testid="banner-schedule">{SCHEDULE_LABELS[b.schedule]}</span></td>
                  <td className="py-1 pr-2"><Switch checked={b.active} onCheckedChange={(on) => toggle(b, on)} aria-label={`${b.title} active`} data-testid="banner-toggle" /></td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    <button type="button" className="inline-flex rounded px-1 py-0.5 text-muted-foreground hover:text-foreground" title="Preview as user" aria-label={`Preview ${b.title}`} onClick={() => setPreviewing(b)} data-testid="banner-row-preview"><Monitor className="size-3.5" aria-hidden="true" /></button>
                    <button type="button" className="inline-flex rounded px-1 py-0.5 text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${b.title}`} onClick={() => setEditing(b)} data-testid="banner-edit"><Pencil className="size-3.5" aria-hidden="true" /></button>
                    <button type="button" className="inline-flex rounded px-1 py-0.5 text-muted-foreground hover:text-loss" title="Delete" aria-label={`Delete ${b.title}`} onClick={() => setDeleting(b)} data-testid="banner-delete"><Trash className="size-3.5" aria-hidden="true" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <BannerDialog key={editing === "new" ? "new" : editing.id} banner={editing === "new" ? null : editing} onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
      {previewing ? <FlyerDialog banners={[previewing]} preview onClose={() => setPreviewing(null)} /> : null}
      <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="sm:max-w-[400px]" data-testid="banner-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete banner?</DialogTitle>
            <DialogDescription>This permanently removes "{deleting?.title}". This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => { toast.success("Deleted", { description: deleting.title }); setDeleting(null); }, onError: (e) => toast.error("Failed", { description: e.message }) })} data-testid="banner-delete-confirm">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";
// Admin · Promotional Emails (HC-AD-071..085, 124..128; ADR-035; docs/design/admin.md §4c): Compose (recipients by
// search and segment, subject, message, placeholder chips, templates, live preview, test send) and History
// (campaigns with delivery counts, detail with per-recipient rows). Send Email is the one amber action, Compose only.
import { type Campaign, type CampaignRecipient, EMAIL_SEGMENT_LABELS, EMAIL_TEMPLATES, type EmailSegment, PLACEHOLDERS, type Recipient, hasPlaceholders, renderTemplate } from "@hapiecoin/schema";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminHeader } from "./AdminShell";
import { type ColumnDef, ColumnsMenu, SortHeader, type SortState, copyCsv, nextSort, useAdminColumns } from "./table-tools";
import { useCampaign, useCampaigns, useRecipients, useSendCampaign, useTestSend } from "@/lib/api/emails";
import { fmtDate } from "@/lib/format";

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const STATUS_TONE: Record<Recipient["status"], string> = { active: "border-profit/60 text-profit", free: "border-border text-muted-foreground", expired: "border-loss/60 text-loss" };
const valuesFor = (r: Recipient) => ({ name: r.name, email: r.email, plan: r.planName ?? "Free", expiry: r.expiresAt ? fmtDate(r.expiresAt) : "no end date" });
const CAMPAIGN_COLUMNS: ColumnDef<Campaign>[] = [
  { key: "subject", label: "Subject", sort: "subject", csv: (c) => c.subject },
  { key: "sentAt", label: "Sent at", sort: "sentAt", csv: (c) => c.sentAt },
  { key: "segment", label: "Segment", hidden: true, csv: (c) => EMAIL_SEGMENT_LABELS[c.segment] },
  { key: "recipients", label: "Recipients", sort: "recipients", align: "right", csv: (c) => String(c.recipients) },
  { key: "delivered", label: "Delivered", sort: "delivered", align: "right", csv: (c) => String(c.delivered) },
  { key: "failed", label: "Failed", sort: "failed", align: "right", csv: (c) => String(c.failed) },
  { key: "sentBy", label: "Sent by", csv: (c) => c.sentBy },
];
const RECIPIENT_COLUMNS: ColumnDef<CampaignRecipient>[] = [
  { key: "name", label: "Name", csv: (r) => r.name },
  { key: "email", label: "Email", csv: (r) => r.email },
  { key: "status", label: "Status", csv: (r) => r.status },
  { key: "sentAt", label: "Sent at", csv: (r) => r.sentAt },
  { key: "error", label: "Error", csv: (r) => r.error ?? "" },
];

function Compose({ onSent, onReadyChange, sendTick }: { onSent: () => void; onReadyChange: (ready: boolean) => void; sendTick: number }) {
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<EmailSegment>("all");
  const [sel, setSel] = useState<Map<string, Recipient>>(new Map());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lastFocus = useRef<"subject" | "message">("message");
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const list = useRecipients(q, segment);
  const send = useSendCampaign();
  const test = useTestSend();
  const rows = list.data?.items ?? [];
  const first: Recipient | undefined = sel.values().next().value;
  const ready = sel.size > 0 && subject.trim() !== "" && message.trim() !== "";
  useEffect(() => onReadyChange(ready), [ready, onReadyChange]);
  const lastTick = useRef(sendTick);
  useEffect(() => {
    if (sendTick !== lastTick.current) {
      lastTick.current = sendTick;
      if (ready) setConfirm(true);
    }
  }, [sendTick, ready]);
  const insert = (token: string) => {
    const field = lastFocus.current;
    const el = field === "subject" ? subjectRef.current : messageRef.current;
    const value = field === "subject" ? subject : message;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}{{${token}}}${value.slice(end)}`;
    if (field === "subject") setSubject(next); else setMessage(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length + 4, start + token.length + 4); });
  };
  const applyTemplate = (key: (typeof EMAIL_TEMPLATES)[number]["key"]) => {
    const tpl = EMAIL_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setSubject(tpl.subject);
    setMessage(tpl.message);
    toast("Template applied", { description: tpl.label });
  };
  const doSend = () => {
    send.mutate(
      { userIds: [...sel.keys()], subject: subject.trim(), message: message.trim(), segment },
      {
        onSuccess: ({ campaign }) => {
          setConfirm(false);
          toast.success("Emails sent", { description: `${campaign.delivered} delivered${campaign.failed ? `, ${campaign.failed} failed` : ""}` });
          setSel(new Map());
          setSubject("");
          setMessage("");
          onSent();
        },
        onError: (e) => { setConfirm(false); toast.error("Send failed", { description: `${e.message} · Please try again.` }); },
      },
    );
  };
  const doTest = () => {
    if (!subject.trim() || !message.trim()) return toast.error("Validation", { description: "Subject and message are required for a test send" });
    test.mutate({ subject: subject.trim(), message: message.trim() }, { onSuccess: (r) => toast.success("Test email sent", { description: `${r.email} · ${r.subject}` }), onError: (e) => toast.error("Test send failed", { description: e.message }) });
  };
  const preview = first ? { subject: renderTemplate(subject, valuesFor(first)), message: renderTemplate(message, valuesFor(first)) } : { subject, message };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]" data-testid="email-compose">
      <section className="rounded border border-border p-3" data-testid="email-recipients">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Recipients</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-3xs" data-testid="email-selected">{sel.size} selected</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSel((s) => { const n = new Map(s); for (const r of rows) n.set(r.id, r); return n; })} disabled={rows.length === 0} data-testid="email-select-all">Select all ({rows.length})</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Map())} disabled={sel.size === 0} data-testid="email-clear">Clear</Button>
        </div>
        <div className="mt-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users by name or email" className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs" aria-label="Search recipients" data-testid="email-search" />
          <select value={segment} onChange={(e) => setSegment(e.target.value as EmailSegment)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Segment" data-testid="email-segment">
            {(Object.keys(EMAIL_SEGMENT_LABELS) as EmailSegment[]).map((s) => <option key={s} value={s}>{EMAIL_SEGMENT_LABELS[s]}</option>)}
          </select>
        </div>
        {list.data?.capped ? <p className="micro mt-1">Showing 200 of {list.data.total} · refine the search</p> : null}
        <ul className="mt-2 max-h-[360px] space-y-0.5 overflow-y-auto text-xs" data-testid="email-recipient-list">
          {list.isLoading ? <li className="h-10 animate-pulse rounded bg-muted" /> : rows.length === 0 ? <li className="micro py-4 text-center" data-testid="email-no-users">No users match the search.</li> : rows.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
                <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Map(s); if (e.target.checked) n.set(r.id, r); else n.delete(r.id); return n; })} aria-label={`Select ${r.email}`} data-testid="email-recipient" data-email={r.email} />
                <span className="min-w-0 flex-1"><span className="font-medium">{r.name}</span> <span className="micro">{r.email}</span></span>
                <span className={cn("rounded border px-1 font-mono text-3xs", STATUS_TONE[r.status])}>{r.planName ?? "Free"}{r.status === "expired" ? " · expired" : ""}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="email-templates">
          <span className="micro mr-1">Templates:</span>
          {EMAIL_TEMPLATES.map((t) => <button key={t.key} type="button" className="rounded border border-border px-1.5 py-0.5 hover:border-foreground/40" onClick={() => applyTemplate(t.key)} data-testid={`email-template-${t.key}`}>{t.label}</button>)}
        </div>
        <label className="block text-xs"><span className="micro">Subject</span><input ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => { lastFocus.current = "subject"; }} placeholder="Your report is ready" className="h-8 w-full rounded border border-input bg-background px-2 text-xs" data-testid="promo-subject" /></label>
        <label className="block text-xs"><span className="micro">Message</span><textarea ref={messageRef} value={message} onChange={(e) => setMessage(e.target.value)} onFocus={() => { lastFocus.current = "message"; }} rows={7} placeholder="Hi {{name}}, …" className="w-full rounded border border-input bg-background px-2 py-1 text-xs" data-testid="promo-message" /></label>
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="email-placeholders">
          <span className="micro mr-1">Insert:</span>
          {PLACEHOLDERS.map((p) => <button key={p} type="button" className="rounded border border-border px-1.5 py-0.5 font-mono text-2xs hover:border-foreground/40" onClick={() => insert(p)} data-testid={`email-insert-${p}`}>{`{{${p}}}`}</button>)}
          <span className="micro">into the last focused field</span>
        </div>
        <div className="rounded border border-border p-3 text-xs" data-testid="email-preview">
          <div className="micro mb-1">{first ? `Preview for ${first.name}` : "Preview · select a recipient to fill placeholders"}</div>
          <div className={cn("font-medium", !first && hasPlaceholders(subject) && "text-warning")} data-testid="email-preview-subject">{preview.subject || "(no subject)"}</div>
          <pre className={cn("mt-1 whitespace-pre-wrap font-sans", !first && hasPlaceholders(message) && "text-warning")} data-testid="email-preview-message">{preview.message || "(no message)"}</pre>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" loading={test.isPending} onClick={doTest} data-testid="email-test">Test send to me</Button>
        </div>
      </section>
      <Dialog open={confirm} onOpenChange={(o) => { if (!send.isPending) setConfirm(o); }}>
        <DialogContent className="sm:max-w-[420px]" data-testid="email-confirm">
          <DialogHeader>
            <DialogTitle>Send to {sel.size} {sel.size === 1 ? "user" : "users"}?</DialogTitle>
            <DialogDescription>{sel.size} selected {sel.size === 1 ? "user" : "users"}. Placeholders are filled per recipient. Sending runs one address at a time and cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={send.isPending}>Cancel</Button>
            <Button loading={send.isPending} onClick={doSend} data-testid="email-send-confirm">{send.isPending ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const d = useCampaign(id);
  const c = d.data?.campaign;
  return (
    <div data-testid="campaign-detail" data-state={d.isLoading ? "loading" : d.isError ? "error" : "ready"}>
      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onBack} data-testid="campaign-back">← Back to campaigns</button>
      {c ? (
        <>
          <h2 className="mt-2 text-[15px] font-medium" data-testid="campaign-subject">{c.subject}</h2>
          <p className="micro">Sent {fmtDateTime(c.sentAt)} · By {c.sentBy} · {EMAIL_SEGMENT_LABELS[c.segment]}</p>
          <div className="mt-3 grid grid-cols-3 gap-3" data-testid="campaign-tiles">
            {[["Recipients", c.recipients, ""], ["Delivered", c.delivered, "text-profit"], ["Failed", c.failed, c.failed > 0 ? "text-loss" : ""]].map(([label, n, tone]) => (
              <div key={String(label)} className="rounded border border-border p-3"><div className="micro">{label}</div><div className={cn("num text-[15px] font-medium", tone)}>{n}</div></div>
            ))}
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded border border-border p-3 font-sans text-xs" data-testid="campaign-message">{c.message}</pre>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-medium">Recipients</span>
            <span className="flex-1" />
            <Button size="sm" variant="outline" disabled={!d.data || d.data.recipients.length === 0} onClick={() => d.data && void copyCsv(d.data.recipients, RECIPIENT_COLUMNS, c.subject)} data-testid="campaign-csv">Copy CSV</Button>
          </div>
          {d.data && d.data.recipients.length === 0 ? <EmptyState title="No recipients recorded" className="py-6" /> : (
            <div className="mt-2 overflow-x-auto rounded border border-border">
              <table className="w-full text-xs" data-testid="campaign-recipients">
                <thead><tr className="micro text-left"><th className="py-1 pl-3 pr-2">Name</th><th className="py-1 pr-2">Email</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Sent at</th><th className="py-1 pr-2">Error</th></tr></thead>
                <tbody>
                  {d.data?.recipients.map((r) => (
                    <tr key={`${r.email}-${r.sentAt}`} className="h-row border-t border-border" data-testid="campaign-recipient" data-status={r.status}>
                      <td className="py-1 pl-3 pr-2">{r.name}</td>
                      <td className="num py-1 pr-2">{r.email}</td>
                      <td className="py-1 pr-2"><span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", r.status === "sent" ? "border-profit/60 text-profit" : "border-loss/60 text-loss")}>{r.status}</span></td>
                      <td className="num py-1 pr-2">{fmtDateTime(r.sentAt)}</td>
                      <td className="py-1 pr-2 text-loss">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : d.isError ? <EmptyState title="Couldn't load the campaign" description={d.error.message} className="py-8" /> : <div className="mt-3 h-20 animate-pulse rounded bg-muted" />}
    </div>
  );
}

function History() {
  const campaigns = useCampaigns();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>({ sort: "sentAt", dir: "desc" });
  const [open, setOpen] = useState<string | null>(null);
  const columns = useAdminColumns("emails", CAMPAIGN_COLUMNS);
  const rows = useMemo(() => {
    const all = (campaigns.data ?? []).filter((c) => !q || `${c.subject} ${EMAIL_SEGMENT_LABELS[c.segment]}`.toLowerCase().includes(q.toLowerCase()));
    const key = sort.sort as keyof Campaign;
    return [...all].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [campaigns.data, q, sort]);
  if (open) return <CampaignDetailView id={open} onBack={() => setOpen(null)} />;
  return (
    <div data-testid="email-history" data-state={campaigns.isLoading ? "loading" : campaigns.isError ? "error" : "ready"} data-count={campaigns.data?.length ?? 0}>
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject or segment" className="h-7 w-[240px] rounded border border-input bg-background px-2 text-xs" aria-label="Search campaigns" data-testid="history-search" />
        <span className="flex-1" />
        <span className="micro">{rows.length} of {campaigns.data?.length ?? 0}</span>
        <ColumnsMenu defs={CAMPAIGN_COLUMNS} columns={columns} testId="history-columns" />
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copyCsv(rows, columns.visible, "campaigns")} data-testid="history-csv">Copy CSV</Button>
      </div>
      {campaigns.isLoading ? <div className="h-20 animate-pulse rounded bg-muted" /> : campaigns.isError ? (
        <EmptyState title="Couldn't load campaigns" description={campaigns.error.message} className="py-10" action={<Button size="sm" onClick={() => void campaigns.refetch()}>Retry</Button>} />
      ) : (campaigns.data?.length ?? 0) === 0 ? (
        <EmptyState title="No campaigns sent yet." description="Compose one and it appears here with its delivery results" className="py-10" data-testid="history-empty" />
      ) : rows.length === 0 ? (
        <EmptyState title="No campaigns match" className="py-10" action={<Button size="sm" variant="outline" onClick={() => setQ("")}>Clear</Button>} />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="history-table">
            <thead><tr className="micro text-left">{columns.visible.map((c) => <th key={c.key} className={cn("py-1 pr-2 first:pl-3", c.align === "right" && "text-right")}><SortHeader label={c.label} sortKey={c.sort} state={sort} onSort={(s) => setSort(nextSort(sort, s.sort, ["recipients", "delivered", "failed", "sentAt"].includes(s.sort)))} align={c.align ?? "left"} testId={`history-sort-${c.key}`} /></th>)}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} tabIndex={0} onClick={() => setOpen(c.id)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(c.id); }} className="h-row cursor-pointer border-t border-border outline-none hover:bg-muted/60 focus-visible:bg-muted/60" data-testid="campaign-row" data-subject={c.subject}>
                  {columns.visible.map((col) => (
                    <td key={col.key} className={cn("py-1 pr-2 first:pl-3", col.align === "right" && "num text-right", col.key === "failed" && c.failed > 0 && "text-loss", col.key === "sentAt" && "num")}>
                      {col.key === "sentAt" ? fmtDateTime(c.sentAt) : col.key === "segment" ? EMAIL_SEGMENT_LABELS[c.segment] : String(c[col.key as keyof Campaign])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function EmailsAdmin() {
  const [tab, setTab] = useState<"compose" | "history">("compose");
  // The header's Send Email (HC-AD-128) drives the Compose form: Compose reports readiness, the header bumps a tick.
  const [ready, setReady] = useState(false);
  const [sendTick, setSendTick] = useState(0);
  const onReadyChange = useCallback((r: boolean) => setReady(r), []);
  return (
    <div data-testid="admin-emails" data-tab={tab}>
      <AdminHeader title="Promotional Emails" subtitle="One message, the people who should get it, and what happened to it" action={tab === "compose" ? <Button size="sm" disabled={!ready} onClick={() => setSendTick((n) => n + 1)} data-testid="email-send">Send Email</Button> : undefined} />
      <div className="mb-3 flex gap-1 border-b border-border" role="tablist">
        {(["compose", "history"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("px-3 py-1.5 text-xs capitalize", tab === t ? "border-b-2 border-accent text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`emails-tab-${t}`}>{t}</button>
        ))}
      </div>
      {tab === "compose" ? <Compose onSent={() => setTab("history")} onReadyChange={onReadyChange} sendTick={sendTick} /> : <History />}
    </div>
  );
}

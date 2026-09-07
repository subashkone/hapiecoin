"use client";
// Exchange Management (HC-SH-045..049): broker cards, Add / Edit form, Delete confirm. Persisted through
// /v1/brokers with optimistic updates.
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Pencil,
  Plus,
  Trash,
  toast,
} from "@hapiecoin/ui";
import { DECIMAL_STRING_RE, isNonNegativeDecimal, type Broker } from "@hapiecoin/schema";
import { useState } from "react";
import { useBrokers, useCreateBroker, useDeleteBroker, useUpdateBroker } from "@/lib/api/queries";
import type { DialogProps } from "./SettingsDialogs";

type FormState = { name: string; feePct: string; gstPct: string; feeCapPct: string };
const EMPTY: FormState = { name: "", feePct: "0.05", gstPct: "18", feeCapPct: "10" };

export function validateBrokerForm(f: FormState): { nameError?: string; body?: Omit<Broker, "id" | "scope"> } {
  if (!f.name.trim()) return { nameError: "Exchange name is required" };
  const pct = (v: string) => (DECIMAL_STRING_RE.test(v.trim()) && isNonNegativeDecimal(v.trim()) ? v.trim() : "0");
  return { body: { name: f.name.trim(), feePct: pct(f.feePct), gstPct: pct(f.gstPct), feeCapPct: pct(f.feeCapPct) } };
}

function BrokerForm({ initial, onDone, onCancel }: { initial?: Broker; onDone: () => void; onCancel: () => void }) {
  const create = useCreateBroker();
  const update = useUpdateBroker();
  const [f, setF] = useState<FormState>(
    initial ? { name: initial.name, feePct: initial.feePct, gstPct: initial.gstPct, feeCapPct: initial.feeCapPct } : EMPTY,
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const busy = create.isPending || update.isPending;
  const submit = () => {
    const v = validateBrokerForm(f);
    if (v.nameError || !v.body) {
      setNameError(v.nameError);
      toast.error("Validation Error", { description: v.nameError });
      return;
    }
    setNameError(undefined);
    const body = v.body;
    const opts = {
      onSuccess: () => {
        toast.success("Success", { description: initial ? "Exchange updated successfully" : "Exchange created successfully" });
        onDone();
      },
      onError: (e: Error) => toast.error("Could not save exchange", { description: e.message }),
    };
    if (initial) update.mutate({ id: initial.id, body }, opts);
    else create.mutate(body, opts);
  };
  return (
    <div data-testid="broker-form">
      <div className="px-5 pt-4">
        <h3>{initial ? "Edit Exchange" : "Add New Exchange"}</h3>
        <p className="text-xs text-muted-foreground">Configure exchange fee structure</p>
      </div>
      <DialogBody>
        <Field label="Exchange Name" error={nameError}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g., Delta Exchange India" data-testid="broker-name" />
        </Field>
        <Field label="Fee Percentage (%)" hint="Percentage of notional value">
          <Input numeric value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} data-testid="broker-fee" />
        </Field>
        <Field label="GST Percentage (%)">
          <Input numeric value={f.gstPct} onChange={(e) => setF({ ...f, gstPct: e.target.value })} data-testid="broker-gst" />
        </Field>
        <Field label="Fee Cap (% of premium)" hint="Maximum fee as percentage of premium">
          <Input numeric value={f.feeCapPct} onChange={(e) => setF({ ...f, feeCapPct: e.target.value })} data-testid="broker-cap" />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={busy} onClick={submit} data-testid="broker-submit">
          {busy ? "Saving..." : initial ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function DeleteConfirm({ broker, onDone, onCancel }: { broker: Broker; onDone: () => void; onCancel: () => void }) {
  const del = useDeleteBroker();
  return (
    <div data-testid="broker-delete">
      <DialogHeader>
        <DialogTitle>Delete Exchange</DialogTitle>
        <DialogDescription>This action cannot be undone</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <p className="text-[13px]">Are you sure you want to delete this exchange?</p>
        <p className="mt-2 text-xs text-warning">⚠️ Warning: Any strategies using this exchange will need to be reconfigured.</p>
        <p className="mt-2 font-mono text-2xs text-muted-foreground">{broker.name}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          loading={del.isPending}
          data-testid="broker-delete-confirm"
          onClick={() =>
            del.mutate(broker.id, {
              onSuccess: () => {
                toast.success("Success", { description: "Exchange deleted successfully" });
                onDone();
              },
              onError: (e) => toast.error("Could not delete", { description: e.message }),
            })
          }
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ExchangeManagementDialog({ open, onOpenChange }: DialogProps) {
  const { data, isLoading, isError, refetch } = useBrokers();
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "add" } | { kind: "edit"; broker: Broker } | { kind: "delete"; broker: Broker }>({ kind: "list" });
  const list = data ?? [];
  const back = () => setMode({ kind: "list" });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) back();
        onOpenChange(o);
      }}
    >
      <DialogContent size="md" data-testid="exchanges-dialog">
        {mode.kind === "add" || mode.kind === "edit" ? (
          <>
            <DialogTitle className="sr-only">{mode.kind === "edit" ? "Edit Exchange" : "Add New Exchange"}</DialogTitle>
            <BrokerForm {...(mode.kind === "edit" ? { initial: mode.broker } : {})} onDone={back} onCancel={back} />
          </>
        ) : mode.kind === "delete" ? (
          <DeleteConfirm broker={mode.broker} onDone={back} onCancel={back} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Exchange Management</DialogTitle>
              <DialogDescription>Manage exchange configurations for paper trading</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground" data-testid="broker-count">
                  {list.length} exchange(s) configured
                </span>
                <Button size="sm" onClick={() => setMode({ kind: "add" })} data-testid="add-exchange">
                  <Plus className="size-3.5" aria-hidden="true" /> Add Exchange
                </Button>
              </div>
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Loading exchanges…</p>
              ) : isError ? (
                <EmptyState title="Could not load exchanges" description="Check your connection and try again." action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>} />
              ) : list.length === 0 ? (
                <EmptyState title="No exchanges configured" description="Add an exchange to configure its fee structure." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((b) => (
                    <li key={b.id} data-testid="broker-row" className="flex items-center gap-3 rounded-md border border-border p-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted font-mono text-sm">{b.name.slice(0, 1)}</div>
                      <div className="min-w-0 flex-1">
                        <b className="flex items-center gap-2 text-[13px]">
                          {b.name}
                          {b.scope === "GLOBAL" ? <Badge variant="outline">GLOBAL</Badge> : null}
                        </b>
                        <div className="flex gap-3 text-2xs text-muted-foreground">
                          <span>Fee: <span className="font-mono">{b.feePct}%</span></span>
                          <span>GST: <span className="font-mono">{b.gstPct}%</span></span>
                          <span>Fee Cap: <span className="font-mono">{b.feeCapPct}%</span></span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setMode({ kind: "edit", broker: b })} data-testid="broker-edit">
                        <Pencil className="size-3.5" aria-hidden="true" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive" disabled={b.scope === "GLOBAL"} title={b.scope === "GLOBAL" ? "Global exchanges are managed by admins" : undefined} onClick={() => setMode({ kind: "delete", broker: b })} data-testid="broker-delete-btn">
                        <Trash className="size-3.5" aria-hidden="true" /> Delete
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

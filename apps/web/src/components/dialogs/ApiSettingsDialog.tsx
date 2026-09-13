"use client";
// Delta Exchange API Settings (HC-SH-031..037, HC-SH-123): status block, the connected keys (one row per account,
// each with its label, masked key and Disconnect), exchange select with fee line, a label and the credentials for a
// new key, whitelist IP copy, Connect & Save → POST /v1/credentials, Disconnect → DELETE. The secret never echoes.
// Several keys per exchange are the accounts of ADR-068 (Delta sub-accounts): a strategy trades through one of them.
import { MAX_ACCOUNTS_PER_BROKER } from "@hapiecoin/schema";
import {
  Button,
  Check,
  CircleAlert,
  Copy,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Spinner,
  toast,
} from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import {
  useBrokers,
  useConnectExchange,
  useCredential,
  disconnectId,
  queryKeys,
  useDisconnectExchange,
  useMe,
  useWhitelistIp,
} from "@/lib/api/queries";
import { useQueryClient } from "@tanstack/react-query";
import { isSecondFactorError } from "@/lib/api/second-factor";
import { SECOND_FACTOR_MISSING_MESSAGE, SecondFactorField, secondFactorMissing } from "./SecondFactorField";
import { useLivePositions } from "@/lib/api/live";
import { accountsOf, useCurrentAccount } from "@/lib/accounts";
import { fmtDate } from "@/lib/format";
import type { DialogProps } from "./SettingsDialogs";

/** The next free label for a broker: "Main" first, then "Sub 1", "Sub 2", … */
export function nextLabel(taken: readonly string[]): string {
  if (!taken.includes("Main")) return "Main";
  for (let i = 1; i < 100; i += 1) if (!taken.includes(`Sub ${i}`)) return `Sub ${i}`;
  return "Account";
}

export function ApiSettingsDialog({ open, onOpenChange }: DialogProps) {
  const credential = useCredential();
  const brokers = useBrokers();
  const ip = useWhitelistIp();
  const connect = useConnectExchange();
  const disconnect = useDisconnectExchange();
  const { account } = useCurrentAccount();
  // ADR-086: an account with the authenticator on confirms a key change with its current code
  const { data: me } = useMe();
  const qc = useQueryClient();
  const needsCode = me?.twoFactorEnabled === true;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCode("");
      setCodeError(null);
    }
  }, [open]);
  /** A refusal for want of a code: under the field when it is shown, else a toast and a fresh /v1/me so the field appears (2FA turned on elsewhere). */
  const refused = (e: Error, title: string): boolean => {
    if (!isSecondFactorError(e)) return false;
    if (needsCode) setCodeError(e.message);
    else {
      toast.error(title, { description: e.message });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    }
    return true;
  };
  const [brokerId, setBrokerId] = useState("");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const list = brokers.data ?? [];
  const items = credential.data?.items ?? [];
  useEffect(() => {
    if (!brokerId) {
      const first = items[0]?.brokerId ?? list[0]?.id;
      if (first) setBrokerId(first);
    }
  }, [brokerId, items, list]);
  const broker = list.find((b) => b.id === brokerId);
  const mine = accountsOf(items, brokerId);
  // the label box proposes the next free name; a name already connected replaces that key
  useEffect(() => {
    if (open && brokerId) setLabel(nextLabel(mine.map((m) => m.label)));
    // once per open and per broker chosen, on purpose: the trader's typing must stay
  }, [open, brokerId, credential.data?.items.length]);
  const connected = items.length > 0;
  // GAPS #42: a stored key sealed under another server key answers 409 on every private call; say so here, where the fix is
  const wallet = useLivePositions(account?.brokerId ?? null, account !== null, account?.id ?? null);
  const staleKey = wallet.isError && /decrypt|reconnect/i.test(wallet.error.message);
  const replacing = mine.find((m) => m.label === label.trim());

  const copyIp = async () => {
    if (!ip.data) return;
    try {
      await navigator.clipboard.writeText(ip.data.ip);
    } catch {
      /* clipboard unavailable */
    }
    toast("Copied", { description: "IP address copied to clipboard" });
  };

  const save = () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("Save Failed", { description: "Failed to save credentials · API key and API secret are required" });
      return;
    }
    if (!brokerId) {
      toast.error("Save Failed", { description: "Select an exchange..." });
      return;
    }
    if (!label.trim()) {
      toast.error("Save Failed", { description: "Name the account (Main, Sub 1, …)" });
      return;
    }
    if (!replacing && mine.length >= MAX_ACCOUNTS_PER_BROKER) {
      toast.error("Save Failed", { description: `At most ${MAX_ACCOUNTS_PER_BROKER} accounts per exchange` });
      return;
    }
    if (secondFactorMissing(needsCode, code)) {
      setCodeError(SECOND_FACTOR_MISSING_MESSAGE);
      return;
    }
    connect.mutate(
      { brokerId, label: label.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), ...(needsCode ? { secondFactor: code } : {}) },
      {
        onSuccess: () => {
          setApiSecret("");
          setApiKey("");
          setCode("");
          setCodeError(null);
          toast.success("Exchange Connected", { description: replacing ? `Key for ${label.trim()} replaced` : "API credentials saved to server" });
        },
        onError: (e) => {
          if (!refused(e, "Save Failed")) toast.error("Save Failed", { description: e.message });
        },
      },
    );
  };

  const remove = (id: string, name: string) => {
    if (secondFactorMissing(needsCode, code)) {
      setCodeError(SECOND_FACTOR_MISSING_MESSAGE);
      return;
    }
    disconnect.mutate(needsCode ? { id, secondFactor: code } : id, {
      onSuccess: () => {
        setCode("");
        setCodeError(null);
        toast("Exchange Disconnected", { description: `${name} · Delta Exchange credentials removed` });
      },
      onError: (e) => {
        if (!refused(e, "Could not disconnect")) toast.error("Could not disconnect", { description: e.message });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="api-dialog">
        <DialogHeader>
          <DialogTitle>Delta Exchange API Settings</DialogTitle>
          <DialogDescription>Connect your exchange account for live trading and wallet balance. A sub-account is one more key with its own name.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div
            data-testid="api-status"
            data-state={credential.isLoading ? "checking" : connected ? "connected" : "disconnected"}
            data-count={items.length}
            className="flex items-start gap-3 rounded-md border border-border bg-surface-1 p-3 text-[12.5px]"
          >
            {credential.isLoading ? (
              <>
                <Spinner size="sm" />
                <b>Checking connection...</b>
              </>
            ) : connected ? (
              <>
                <Check className="size-4 text-profit" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <b>{staleKey ? "Connected · key needs re-entering" : items.length === 1 ? "Connected" : `Connected · ${items.length} accounts`}</b>
                  {staleKey ? (
                    <div className="mt-1 rounded border border-warning/60 p-2 text-2xs text-warning" data-testid="api-stale-key">
                      {wallet.error.message} Paste the key and secret again below and press Connect &amp; Save.
                    </div>
                  ) : null}
                  <div className="mt-1 flex flex-col gap-1" data-testid="api-accounts">
                    {items.map((it) => (
                      <div key={it.id} className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 font-mono text-2xs" data-testid="api-account" data-label={it.label}>
                        <b className="font-sans">{it.label}</b>
                        <span className="text-muted-foreground">API Key: {it.apiKeyMasked}</span>
                        <span className="text-muted-foreground">Connected: {fmtDate(it.connectedAt)}</span>
                        <Button variant="ghost" size="sm" className="ml-auto text-destructive" loading={disconnect.isPending && disconnect.variables !== undefined && disconnectId(disconnect.variables) === it.id} onClick={() => remove(it.id, it.label)} title="Remove this key · refused while a live strategy still trades through it" data-testid="disconnect-exchange" data-account-id={it.id}>
                          Disconnect
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <CircleAlert className="size-4 text-warning" aria-hidden="true" />
                <div>
                  <b>Not Connected</b>
                  <div className="text-muted-foreground">Enter your Delta Exchange API credentials to enable live trading.</div>
                </div>
              </>
            )}
          </div>

          <div className="micro mt-4 mb-1.5">Select Exchange</div>
          <Select
            aria-label="Select Exchange"
            value={brokerId}
            onValueChange={setBrokerId}
            placeholder={list.length ? "Select an exchange" : "No exchanges configured"}
            options={list.map((b) => ({ value: b.id, label: `${b.name} (${b.feePct}% fee)` }))}
          />
          <div className="mt-1 text-2xs text-muted-foreground" data-testid="fee-line">
            {broker ? `Fee: ${broker.feePct}% · GST: ${broker.gstPct}% · Cap: ${broker.feeCapPct}%` : ""}
          </div>

          <div className="micro mt-4 mb-1.5">{mine.length ? "Add a key (a sub-account) or replace one" : "API Credentials"}</div>
          <Field label="Account name">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main, Sub 1, Hedge book…" maxLength={32} data-testid="api-label" />
          </Field>
          {replacing ? <p className="mb-1 text-2xs text-warning" data-testid="api-replacing">Saving replaces the key stored for {replacing.label}.</p> : null}
          <Field label="API Key">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Enter your Delta Exchange API key" autoComplete="off" className="font-mono" data-testid="api-key" />
          </Field>
          <Field label="API Secret">
            <Input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Enter your Delta Exchange API secret" autoComplete="new-password" className="font-mono" data-testid="api-secret" />
          </Field>
          <p className="text-2xs text-muted-foreground">
            Get your API key from{" "}
            <a href="https://www.delta.exchange/app/account/manageapikeys" target="_blank" rel="noopener noreferrer" className="underline">
              Delta Exchange → Account → API Keys
            </a>
            . For a sub-account, switch to it on Delta before creating the key; its margin and positions stay apart from the main account's.
          </p>

          <div className="micro mt-4 mb-1.5">Whitelisted IP Address</div>
          <div className="flex items-center gap-2">
            <code className="rounded border border-border bg-surface-1 px-2 py-1 font-mono text-xs" data-testid="whitelist-ip">
              {ip.data?.ip ?? (ip.isLoading ? "…" : "unavailable")}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copyIp()} disabled={!ip.data} data-testid="copy-ip">
              <Copy className="size-3.5" aria-hidden="true" /> Copy
            </Button>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">Add this IP to your Delta Exchange API key whitelist for secure access.</p>
          {needsCode ? <SecondFactorField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} what="a key change" /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={connect.isPending} onClick={save} data-testid="connect-save">
            {connect.isPending ? "Connecting..." : "Connect & Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";
// Delta Exchange API Settings (HC-SH-031..037): status block, exchange select with fee line, credentials,
// whitelist IP copy, Connect & Save → POST /v1/credentials, Disconnect → DELETE. The secret never echoes.
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
  useDisconnectExchange,
  useWhitelistIp,
} from "@/lib/api/queries";
import { useLivePositions } from "@/lib/api/live";
import { fmtDate } from "@/lib/format";
import type { DialogProps } from "./SettingsDialogs";

export function ApiSettingsDialog({ open, onOpenChange }: DialogProps) {
  const credential = useCredential();
  const brokers = useBrokers();
  const ip = useWhitelistIp();
  const connect = useConnectExchange();
  const disconnect = useDisconnectExchange();
  const [brokerId, setBrokerId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const list = brokers.data ?? [];
  useEffect(() => {
    if (!brokerId) {
      const first = credential.data?.items[0]?.brokerId ?? list[0]?.id;
      if (first) setBrokerId(first);
    }
  }, [brokerId, credential.data, list]);
  const broker = list.find((b) => b.id === brokerId);
  const connected = credential.data?.items[0] ?? null;
  // GAPS #42: a stored key sealed under another server key answers 409 on every private call; say so here, where the fix is
  const wallet = useLivePositions(connected?.brokerId ?? null);
  const staleKey = wallet.isError && /decrypt|reconnect/i.test(wallet.error.message);

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
    connect.mutate(
      { brokerId, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() },
      {
        onSuccess: () => {
          setApiSecret("");
          setApiKey("");
          toast.success("Exchange Connected", { description: "API credentials saved to server" });
        },
        onError: (e) => toast.error("Save Failed", { description: e.message }),
      },
    );
  };

  const remove = () => {
    if (!connected) return;
    disconnect.mutate(connected.brokerId, {
      onSuccess: () => toast("Exchange Disconnected", { description: "Delta Exchange credentials removed" }),
      onError: (e) => toast.error("Could not disconnect", { description: e.message }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="api-dialog">
        <DialogHeader>
          <DialogTitle>Delta Exchange API Settings</DialogTitle>
          <DialogDescription>Connect your exchange account for live trading and wallet balance.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div
            data-testid="api-status"
            data-state={credential.isLoading ? "checking" : connected ? "connected" : "disconnected"}
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
                <div>
                  <b>{staleKey ? "Connected · key needs re-entering" : "Connected"}</b>
                  {staleKey ? (
                    <div className="mt-1 rounded border border-warning/60 p-2 text-2xs text-warning" data-testid="api-stale-key">
                      {wallet.error.message} Paste the key and secret again below and press Connect &amp; Save.
                    </div>
                  ) : null}
                  <div className="font-mono text-2xs text-muted-foreground">API Key: {connected.apiKeyMasked}</div>
                  <div className="font-mono text-2xs text-muted-foreground">Connected: {fmtDate(connected.connectedAt)}</div>
                  <div className="font-mono text-2xs text-muted-foreground">Wallet: — (arrives with live trading)</div>
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

          <div className="micro mt-4 mb-1.5">API Credentials</div>
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
        </DialogBody>
        <DialogFooter>
          {connected ? (
            <Button variant="outline" className="mr-auto text-destructive" loading={disconnect.isPending} onClick={remove} data-testid="disconnect-exchange">
              Disconnect Exchange
            </Button>
          ) : null}
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

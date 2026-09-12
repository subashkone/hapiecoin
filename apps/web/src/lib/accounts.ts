// Accounts (ADR-068; HC-SH-123, HC-TR-173..175): one connected exchange key is one account; a broker may have several
// (Delta sub-accounts), told apart by their label. A strategy names the account it trades through; the chrome (wallet
// chip, portfolio bar, net positions) reads the account the trader last chose, else the first connected key.
import type { BrokerCredentialPublic, Strategy } from "@hapiecoin/schema";
import { useCredential } from "@/lib/api/queries";
import { useUiStore } from "@/lib/store";

export interface AccountRef {
  brokerId: string;
  /** The key row; null when the strategy predates accounts and its broker has several keys (nothing can be read for it). */
  accountId: string | null;
}

/** One key per group for the positions reads: "brk_delta|crd_1". */
export function accountKey(brokerId: string, accountId: string | null): string {
  return `${brokerId}|${accountId ?? ""}`;
}

export function accountsOf(items: readonly BrokerCredentialPublic[], brokerId: string | null): BrokerCredentialPublic[] {
  return brokerId ? items.filter((i) => i.brokerId === brokerId) : [];
}

export function accountLabel(items: readonly BrokerCredentialPublic[], accountId: string | null | undefined): string | null {
  return accountId ? (items.find((i) => i.id === accountId)?.label ?? null) : null;
}

/** The account a strategy trades through: the one it names, else its broker's only key. */
export function accountRefOf(s: Pick<Strategy, "brokerId" | "accountId">, items: readonly BrokerCredentialPublic[]): AccountRef | null {
  if (!s.brokerId) return null;
  // a key that is no longer connected (a paper strategy's, deleted) is not read: the broker's only key, or none
  if (s.accountId && items.some((i) => i.id === s.accountId)) return { brokerId: s.brokerId, accountId: s.accountId };
  const mine = accountsOf(items, s.brokerId);
  return { brokerId: s.brokerId, accountId: mine.length === 1 ? (mine[0]?.id ?? null) : null };
}

/** The account the chrome reads: the last one chosen in a trade dialog or the net-positions panel, else the first key of the exchange chosen last, else the first key. */
export function useCurrentAccount(): { account: BrokerCredentialPublic | null; items: BrokerCredentialPublic[]; loading: boolean } {
  const { data, isLoading } = useCredential();
  const chosen = useUiStore((s) => s.accountId);
  const brokerId = useUiStore((s) => s.brokerId);
  const items = data?.items ?? [];
  const account = items.find((i) => i.id === chosen) ?? items.find((i) => i.brokerId === brokerId) ?? items[0] ?? null;
  return { account, items, loading: isLoading };
}

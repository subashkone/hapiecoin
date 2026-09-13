// Live trading through TanStack Query (Phase 3 item 2, ADR-025): preview, place, retry, sync, batch, positions.
// Every order goes through the API's executor; the browser never talks to the venue.
import { type LiveBatchBody, LiveBatchPreview, type LiveBatchPreviewBody, LiveBatchResult, type LivePlaceBody, LivePositions, type LivePositionsExitBody, LivePositionsExitResult, LivePreview, type LivePreviewBody, type LiveRetryBody, MindfulPreview, Strategy, type LiveRepriceBody } from "@hapiecoin/schema";

/** Preview body: the open legs by default, or an adjustment batch's adds / changes (ADR-044). */
export type PreviewBody = LivePreviewBody & { worstLoss?: number | undefined };
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AccountRef, accountKey } from "@/lib/accounts";
import { api, type ApiClient } from "./client";
import { strategyKeys } from "./strategies";

const enc = encodeURIComponent;

export function liveFetchers(client: ApiClient = api) {
  return {
    preview: (id: string, body: PreviewBody) => client.post(`/v1/strategies/${enc(id)}/live/preview`, body, LivePreview),
    place: (id: string, body: LivePlaceBody) => client.post(`/v1/strategies/${enc(id)}/live/place`, body, Strategy),
    retry: (id: string, body: LiveRetryBody) => client.post(`/v1/strategies/${enc(id)}/live/retry`, body, Strategy), // HC-TR-186: the word as typed
    sync: (id: string) => client.post(`/v1/strategies/${enc(id)}/live/sync`, {}, Strategy),
    // GAPS #61 / ADR-083: a resting limit entry pulled (no word: it reduces exposure) or moved (the word: it stays a live entry)
    cancelOrder: (id: string, orderId: string) => client.post(`/v1/strategies/${enc(id)}/live/orders/${enc(orderId)}/cancel`, {}, Strategy),
    repriceOrder: (id: string, orderId: string, body: LiveRepriceBody) => client.post(`/v1/strategies/${enc(id)}/live/orders/${enc(orderId)}/reprice`, body, Strategy),
    batch: (body: LiveBatchBody) => client.post("/v1/strategies/live/batch", body, LiveBatchResult),
    batchPreview: (body: LiveBatchPreviewBody) => client.post("/v1/strategies/live/batch/preview", body, LiveBatchPreview), // ADR-087
    // ADR-084: the server's day figure and the pause it decides; reading it starts the batch's pause clock on the server
    dayPnl: () => client.get("/v1/me/day-pnl", MindfulPreview),
    positions: (brokerId: string, accountId: string | null = null) => client.get(`/v1/strategies/live/positions?brokerId=${enc(brokerId)}${accountId ? `&accountId=${enc(accountId)}` : ""}`, LivePositions),
    exitPositions: (body: LivePositionsExitBody) => client.post("/v1/strategies/live/positions/exit", body, LivePositionsExitResult),
  };
}

const f = liveFetchers();

/** A fresh idempotency key per placement attempt (ADR-025). */
export function newIdempotencyKey(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `web-${rnd}`;
}

function useLiveMutation<TVars, TResult extends Strategy | void | { placed: string[] }>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (s: TResult) => {
      if (s && "id" in s) qc.setQueryData(strategyKeys.one(s.id), s);
      void qc.invalidateQueries({ queryKey: strategyKeys.all });
      void qc.invalidateQueries({ queryKey: ["live", "positions"] }); // the venue's positions changed with the orders
    },
  });
}

export function useLivePreview() {
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: PreviewBody }) => f.preview(id, body) });
}
export function useLivePlace() {
  return useLiveMutation(({ id, body }: { id: string; body: LivePlaceBody }) => f.place(id, body));
}
export function useLiveRetry() {
  return useLiveMutation(({ id, confirm }: { id: string; confirm: string }) => f.retry(id, { confirm }));
}
export function useLiveSync() {
  return useLiveMutation((id: string) => f.sync(id));
}
/** Cancel a resting limit entry (HC-TR-187). */
export function useLiveCancelOrder() {
  return useLiveMutation(({ id, orderId }: { id: string; orderId: string }) => f.cancelOrder(id, orderId));
}
/** Move a resting limit entry's price (HC-TR-188); the word as typed. */
export function useLiveRepriceOrder() {
  return useLiveMutation(({ id, orderId, limitPrice, confirm }: { id: string; orderId: string; limitPrice: string; confirm: string }) => f.repriceOrder(id, orderId, { limitPrice, confirm }));
}
export function useLiveBatch() {
  return useLiveMutation((body: LiveBatchBody) => f.batch(body));
}
/** The batch preview for the ticked strategies (ADR-087); off while nothing is ticked or no exchange is chosen. */
export function useBatchPreview(body: LiveBatchPreviewBody | null) {
  return useQuery({
    queryKey: ["live", "batch-preview", body?.brokerId ?? "", body?.accountId ?? "", [...(body?.ids ?? [])].sort().join(",")],
    queryFn: () => f.batchPreview(body!),
    enabled: body !== null && body.ids.length > 0 && body.brokerId !== "",
    staleTime: 15_000,
    placeholderData: keepPreviousData, // the rows keep their last check while a tick change re-asks; the button waits for the fresh answer
  });
}
/** The server's live day P&L for the batch dialog (HC-TR-189): fetched when the dialog opens, never cached across openings. */
export function useLiveDay(enabled: boolean) {
  return useQuery({ queryKey: ["live", "day"], queryFn: () => f.dayPnl(), enabled, staleTime: 0, gcTime: 0 });
}
/** Square off ticked exchange positions (HC-TR-145): reduce-only market orders through the executor. */
export function useLiveExitPositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LivePositionsExitBody) => f.exitPositions(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["live", "positions"] });
      void qc.invalidateQueries({ queryKey: strategyKeys.all });
    },
  });
}
const positionsQuery = (brokerId: string | null, accountId: string | null, enabled: boolean) => ({
  queryKey: ["live", "positions", brokerId ?? "", accountId ?? ""],
  queryFn: () => f.positions(brokerId ?? "", accountId),
  enabled: enabled && brokerId !== null,
  staleTime: 10_000,
  refetchInterval: 15_000,
});
/** Positions and balances of one account (ADR-068): the broker's only key when no account is named. */
export function useLivePositions(brokerId: string | null, enabled = true, accountId: string | null = null) {
  return useQuery(positionsQuery(brokerId, accountId, enabled));
}
/**
 * One positions read per account for the out-of-sync check (HC-TR-175): each live strategy is compared with the
 * account it trades through. `ready` only once every read succeeded; `error` is the first failure.
 */
export function useAccountPositions(refs: readonly AccountRef[], enabled = true) {
  const results = useQueries({ queries: refs.map((r) => positionsQuery(r.brokerId, r.accountId, enabled)) });
  const byKey = new Map<string, LivePositions>();
  results.forEach((q, i) => {
    const ref = refs[i]!;
    if (q.isSuccess && q.data) byKey.set(accountKey(ref.brokerId, ref.accountId), q.data);
  });
  const ready = enabled && results.every((q) => q.isSuccess && !q.isError);
  const error: Error | null = results.find((q) => q.isError)?.error ?? null;
  const updatedAt = results.reduce((m, q) => Math.max(m, q.dataUpdatedAt), 0);
  const first = refs[0] ? byKey.get(accountKey(refs[0].brokerId, refs[0].accountId)) : undefined;
  const positions = [...byKey.values()].flatMap((d) => d.positions);
  /** Re-reads every account; true when all answered. */
  const refetch = async () => (await Promise.all(results.map((q) => q.refetch()))).every((r) => r.isSuccess);
  return { byKey, first, positions, ready, error, updatedAt, refetch };
}

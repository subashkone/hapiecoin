// Live trading through TanStack Query (Phase 3 item 2, ADR-025): preview, place, retry, sync, batch, positions.
// Every order goes through the API's executor; the browser never talks to the venue.
import { type LiveBatchBody, LiveBatchResult, type LivePlaceBody, LivePositions, type LivePositionsExitBody, LivePositionsExitResult, LivePreview, Strategy } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";
import { strategyKeys } from "./strategies";

const enc = encodeURIComponent;

export function liveFetchers(client: ApiClient = api) {
  return {
    preview: (id: string, body: { brokerId: string; worstLoss?: number }) => client.post(`/v1/strategies/${enc(id)}/live/preview`, body, LivePreview),
    place: (id: string, body: LivePlaceBody) => client.post(`/v1/strategies/${enc(id)}/live/place`, body, Strategy),
    retry: (id: string) => client.post(`/v1/strategies/${enc(id)}/live/retry`, {}, Strategy),
    sync: (id: string) => client.post(`/v1/strategies/${enc(id)}/live/sync`, {}, Strategy),
    batch: (body: LiveBatchBody) => client.post("/v1/strategies/live/batch", body, LiveBatchResult),
    positions: (brokerId: string) => client.get(`/v1/strategies/live/positions?brokerId=${enc(brokerId)}`, LivePositions),
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
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: { brokerId: string; worstLoss?: number } }) => f.preview(id, body) });
}
export function useLivePlace() {
  return useLiveMutation(({ id, body }: { id: string; body: LivePlaceBody }) => f.place(id, body));
}
export function useLiveRetry() {
  return useLiveMutation((id: string) => f.retry(id));
}
export function useLiveSync() {
  return useLiveMutation((id: string) => f.sync(id));
}
export function useLiveBatch() {
  return useLiveMutation((body: LiveBatchBody) => f.batch(body));
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
export function useLivePositions(brokerId: string | null, enabled = true) {
  return useQuery({ queryKey: ["live", "positions", brokerId ?? ""], queryFn: () => f.positions(brokerId ?? ""), enabled: enabled && brokerId !== null, staleTime: 10_000, refetchInterval: 15_000 });
}

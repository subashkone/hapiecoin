// Saved Autopilot strategies through TanStack Query (ADR-141, ADR-142; HC-TR-270..278): the admin's list and the steps
// a strategy goes through. Paper only: nothing here can place an order.
import { SavedStrategy, type SavedStrategyCreate, SavedStrategyList, type SavedStrategyPatch } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";

const enc = encodeURIComponent;
const BASE = "/v1/admin/autopilot-strategies";
export const savedStrategyKeys = { admin: ["autopilot-strategies", "admin"] as const };

export function savedStrategyFetchers(client: ApiClient = api) {
  return {
    list: () => client.get(BASE, SavedStrategyList),
    create: (body: SavedStrategyCreate) => client.post(BASE, body, SavedStrategy),
    update: (id: string, body: SavedStrategyPatch) => client.patch(`${BASE}/${enc(id)}`, body, SavedStrategy),
    duplicate: (id: string) => client.post(`${BASE}/${enc(id)}/duplicate`, {}, SavedStrategy),
    publish: (id: string) => client.post(`${BASE}/${enc(id)}/publish`, {}, SavedStrategy),
    retire: (id: string) => client.post(`${BASE}/${enc(id)}/retire`, {}, SavedStrategy),
    remove: (id: string) => client.delete(`${BASE}/${enc(id)}`),
  };
}
const f = savedStrategyFetchers();

export function useSavedStrategies() {
  return useQuery({ queryKey: savedStrategyKeys.admin, queryFn: async () => (await f.list()).items, staleTime: 10_000 });
}
function useSavedMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: run, onSuccess: () => void qc.invalidateQueries({ queryKey: savedStrategyKeys.admin }) });
}
export function useCreateSavedStrategy() {
  return useSavedMutation((body: SavedStrategyCreate) => f.create(body));
}
export function useUpdateSavedStrategy() {
  return useSavedMutation(({ id, body }: { id: string; body: SavedStrategyPatch }) => f.update(id, body));
}
/** One of the steps that take no body: a copy, to paper, retired. */
export function useSavedStrategyStep() {
  return useSavedMutation(({ id, step }: { id: string; step: "duplicate" | "publish" | "retire" }) => f[step](id));
}
export function useDeleteSavedStrategy() {
  return useSavedMutation((id: string) => f.remove(id));
}

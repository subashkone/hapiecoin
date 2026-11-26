// Saved Autopilot strategies through TanStack Query (ADR-141, ADR-142; HC-TR-270..278): the admin's list and the steps
// a strategy goes through, and the backtest of one in the app (ADR-144; HC-TR-289, HC-TR-290). Paper only: nothing
// here can place an order.
import { SavedBacktestRun, type SavedBacktestStart, SavedStrategy, type SavedStrategyCreate, SavedStrategyList, type SavedStrategyPatch } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";

const enc = encodeURIComponent;
const BASE = "/v1/admin/autopilot-strategies";
export const savedStrategyKeys = { admin: ["autopilot-strategies", "admin"] as const, allBacktests: ["autopilot-strategies", "backtests"] as const, backtests: (id: string) => ["autopilot-strategies", "backtests", id] as const };
const SavedBacktestRuns = z.object({ items: z.array(SavedBacktestRun) });
/** How often a running backtest is asked how far it is. */
export const BACKTEST_POLL_MS = 2_000;

export function savedStrategyFetchers(client: ApiClient = api) {
  return {
    list: () => client.get(BASE, SavedStrategyList),
    create: (body: SavedStrategyCreate) => client.post(BASE, body, SavedStrategy),
    update: (id: string, body: SavedStrategyPatch) => client.patch(`${BASE}/${enc(id)}`, body, SavedStrategy),
    duplicate: (id: string) => client.post(`${BASE}/${enc(id)}/duplicate`, {}, SavedStrategy),
    publish: (id: string) => client.post(`${BASE}/${enc(id)}/publish`, {}, SavedStrategy),
    retire: (id: string) => client.post(`${BASE}/${enc(id)}/retire`, {}, SavedStrategy),
    remove: (id: string) => client.delete(`${BASE}/${enc(id)}`),
    backtests: (id: string) => client.get(`${BASE}/${enc(id)}/backtests`, SavedBacktestRuns),
    startBacktest: (id: string, body: SavedBacktestStart) => client.post(`${BASE}/${enc(id)}/backtests`, body, SavedBacktestRun),
    useBacktest: (id: string, run: string) => client.post(`${BASE}/${enc(id)}/backtests/${enc(run)}/use`, {}, SavedStrategy),
  };
}
const f = savedStrategyFetchers();

export function useSavedStrategies() {
  return useQuery({ queryKey: savedStrategyKeys.admin, queryFn: async () => (await f.list()).items, staleTime: 10_000 });
}
function useSavedMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  // (a change to a strategy can make its backtest runs stale: they are read again too)
  return useMutation({ mutationFn: run, onSuccess: () => { void qc.invalidateQueries({ queryKey: savedStrategyKeys.admin }); void qc.invalidateQueries({ queryKey: savedStrategyKeys.allBacktests }); } });
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

/** The latest backtest runs of a strategy, newest first; asked again every two seconds while one is running. */
export function useSavedBacktests(id: string) {
  return useQuery({
    queryKey: savedStrategyKeys.backtests(id),
    queryFn: async () => (await f.backtests(id)).items,
    // whether a run still matches the strategy's settings decides what can be used: never read from an old answer
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? BACKTEST_POLL_MS : false),
  });
}
export function useStartSavedBacktest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SavedBacktestStart) => f.startBacktest(id, body),
    // the run is on the list the moment it starts, so a second press cannot slip in before the next read
    onSuccess: (run) => qc.setQueryData<SavedBacktestRun[]>(savedStrategyKeys.backtests(id), (old) => [run, ...(old ?? []).filter((r) => r.id !== run.id)]),
    onSettled: () => qc.invalidateQueries({ queryKey: savedStrategyKeys.backtests(id) }),
  });
}
/** Puts a finished run's figures on the strategy: the list shows them, and the runs are read again. */
export function useUseSavedBacktest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: string) => f.useBacktest(id, run),
    // (after a refusal too: it means the runs on screen are not what the server has)
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: savedStrategyKeys.admin });
      return qc.invalidateQueries({ queryKey: savedStrategyKeys.backtests(id) });
    },
  });
}

// Saved Autopilot strategies through TanStack Query (ADR-141, ADR-142; HC-TR-270..278): the admin's list and the steps
// a strategy goes through, and the backtest of one in the app (ADR-144; HC-TR-289, HC-TR-290). Paper only: nothing
// here can place an order.
import { SavedApprovalView, SavedBacktestRun, type SavedBacktestStart, SavedStrategy, type SavedStrategyCreate, SavedStrategyList, type SavedStrategyPatch } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";
import { secondFactorHeaders } from "./second-factor";

const enc = encodeURIComponent;
const BASE = "/v1/admin/autopilot-strategies";
export const savedStrategyKeys = { admin: ["autopilot-strategies", "admin"] as const, allBacktests: ["autopilot-strategies", "backtests"] as const, approval: (id: string) => ["autopilot-strategies", "approval", id] as const, backtests: (id: string) => ["autopilot-strategies", "backtests", id] as const };
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
    approval: (id: string) => client.get(`${BASE}/${enc(id)}/approval`, SavedApprovalView),
    // (an account with the authenticator on sends its current code in a header, ADR-086)
    // (`read` is what the approver ticked: the server refuses anything but true, and nothing here says it for them)
    approve: (id: string, read: boolean, code?: string) => client.request(`${BASE}/${enc(id)}/approve`, { method: "POST", body: { read }, schema: SavedStrategy, ...(secondFactorHeaders(code) ? { headers: secondFactorHeaders(code)! } : {}) }),
    withdrawApproval: (id: string, code?: string) => client.request(`${BASE}/${enc(id)}/withdraw-approval`, { method: "POST", body: {}, schema: SavedStrategy, ...(secondFactorHeaders(code) ? { headers: secondFactorHeaders(code)! } : {}) }),
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

/** The paper record of a strategy against the approval checks (ADR-145; HC-TR-294): read afresh every time, the record moves with every trade. */
export function useSavedApproval(id: string) {
  return useQuery({ queryKey: savedStrategyKeys.approval(id), queryFn: () => f.approval(id), staleTime: 0, gcTime: 0 });
}
/** Approve for live, or withdraw it. A record on a strategy that stays on paper: nothing is placed. After either, and after a refusal, the list and the view are read again. */
export function useSavedApprovalStep(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ step, read, code }: { step: "approve" | "withdraw"; read: boolean; code?: string }) => (step === "approve" ? f.approve(id, read, code) : f.withdrawApproval(id, code)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: savedStrategyKeys.admin });
      return qc.invalidateQueries({ queryKey: savedStrategyKeys.approval(id) });
    },
  });
}

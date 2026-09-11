// Strategies through TanStack Query (Phase 3, ADR-024). Keys are typed factories; every mutation refreshes
// the list so the Builder, Templates, Paper tab and Details read one source of truth.
import {
  type AddLegsBody,
  type AdjustBody,
  type CloseAllBody,
  type ReconcileBody,
  type CloseLegBody,
  type PnlPoint,
  type StopBody,
  Strategy,
  type StrategyCreate,
  StrategyList,
  type StrategyPatch,
  type StrategyStart,
  type StrategyStatus, type RulesBody } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";

export const strategyKeys = {
  all: ["strategies"] as const,
  list: (status?: StrategyStatus) => (status ? (["strategies", "list", status] as const) : (["strategies", "list"] as const)),
  one: (id: string) => ["strategies", "one", id] as const,
};

const enc = encodeURIComponent;

export function strategyFetchers(client: ApiClient = api) {
  return {
    list: async (status?: StrategyStatus) => (await client.get(`/v1/strategies${status ? `?status=${status}` : ""}`, StrategyList)).items,
    one: (id: string) => client.get(`/v1/strategies/${enc(id)}`, Strategy),
    create: (body: StrategyCreate) => client.post("/v1/strategies", body, Strategy),
    patch: (id: string, body: StrategyPatch) => client.patch(`/v1/strategies/${enc(id)}`, body, Strategy),
    remove: (id: string) => client.delete(`/v1/strategies/${enc(id)}`),
    start: (id: string, body: StrategyStart) => client.post(`/v1/strategies/${enc(id)}/start`, body, Strategy),
    addLegs: (id: string, body: AddLegsBody) => client.post(`/v1/strategies/${enc(id)}/legs`, body, Strategy),
    adjust: (id: string, body: AdjustBody) => client.post(`/v1/strategies/${enc(id)}/adjust`, body, Strategy),
    closeLeg: (id: string, legId: string, body: CloseLegBody) => client.post(`/v1/strategies/${enc(id)}/legs/${enc(legId)}/close`, body, Strategy),
    closeAll: (id: string, body: CloseAllBody) => client.post(`/v1/strategies/${enc(id)}/close`, body, Strategy),
    reconcile: (id: string, body: ReconcileBody) => client.post(`/v1/strategies/${enc(id)}/reconcile`, body, Strategy),
    setRules: (id: string, body: RulesBody) => client.put(`/v1/strategies/${enc(id)}/rules`, body, Strategy),
    clearRules: (id: string) => client.delete(`/v1/strategies/${enc(id)}/rules`),
    stop: (id: string, body: StopBody) => client.post(`/v1/strategies/${enc(id)}/stop`, body, Strategy),
    archive: (id: string) => client.post(`/v1/strategies/${enc(id)}/archive`, {}, Strategy),
    restore: (id: string) => client.post(`/v1/strategies/${enc(id)}/restore`, {}, Strategy),
    pnl: (id: string, body: PnlPoint) => client.post(`/v1/strategies/${enc(id)}/pnl`, body, Strategy),
  };
}

const f = strategyFetchers();

/** Every strategy of the signed-in user; components filter by status. */
export function useStrategies() {
  return useQuery({ queryKey: strategyKeys.list(), queryFn: () => f.list(), staleTime: 15_000 });
}

function useStrategyMutation<TVars, TResult extends Strategy | void>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (s: TResult) => {
      if (s) qc.setQueryData(strategyKeys.one(s.id), s);
      void qc.invalidateQueries({ queryKey: strategyKeys.all });
      void qc.invalidateQueries({ queryKey: ["live", "positions"] }); // the exchange side of the drift check (HC-TR-160) moves with the legs
    },
  });
}

export function useCreateStrategy() {
  return useStrategyMutation((body: StrategyCreate) => f.create(body));
}
export function usePatchStrategy() {
  return useStrategyMutation(({ id, body }: { id: string; body: StrategyPatch }) => f.patch(id, body));
}
export function useDeleteStrategy() {
  return useStrategyMutation((id: string) => f.remove(id));
}
export function useStartStrategy() {
  return useStrategyMutation(({ id, body }: { id: string; body: StrategyStart }) => f.start(id, body));
}
export function useAddLegs() {
  return useStrategyMutation(({ id, body }: { id: string; body: AddLegsBody }) => f.addLegs(id, body));
}
/** One atomic adjustment batch (ADR-044): trims, closes and adds with the marks the trader reviewed. */
/** Arm the stop / target set of a strategy (HC-TR-165); the list refreshes so the card badge follows. */
export function useSetRules() {
  return useStrategyMutation(({ id, body }: { id: string; body: RulesBody }) => f.setRules(id, body));
}
export function useClearRules() {
  return useStrategyMutation((id: string) => f.clearRules(id));
}
export function useAdjustStrategy() {
  return useStrategyMutation(({ id, body }: { id: string; body: AdjustBody }) => f.adjust(id, body));
}
export function useCloseLeg() {
  return useStrategyMutation(({ id, legId, body }: { id: string; legId: string; body: CloseLegBody }) => f.closeLeg(id, legId, body));
}
export function useCloseAll() {
  return useStrategyMutation(({ id, body }: { id: string; body: CloseAllBody }) => f.closeAll(id, body));
}
/** HC-TR-161: book lots closed outside the app; no order is sent. */
export function useReconcileStrategy() {
  return useStrategyMutation(({ id, body }: { id: string; body: ReconcileBody }) => f.reconcile(id, body));
}
export function useStopStrategy() {
  return useStrategyMutation(({ id, body }: { id: string; body: StopBody }) => f.stop(id, body));
}
export function useArchiveStrategy() {
  return useStrategyMutation(({ id, archived }: { id: string; archived: boolean }) => (archived ? f.archive(id) : f.restore(id)));
}
export function useRecordPnl() {
  return useStrategyMutation(({ id, body }: { id: string; body: PnlPoint }) => f.pnl(id, body));
}

// Alerts through TanStack Query (Phase 5 item 2, ADR-052). One list per user; every mutation refreshes it so the
// bell, the settings menu, the dialog and the engine read one source of truth.
import { Alert, type AlertCreate, AlertList, type AlertPatch, type AlertTrigger } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";

export const alertKeys = {
  all: ["alerts"] as const,
  list: ["alerts", "list"] as const,
};

const enc = encodeURIComponent;

export function alertFetchers(client: ApiClient = api) {
  return {
    list: async () => (await client.get("/v1/alerts", AlertList)).items,
    create: (body: AlertCreate) => client.post("/v1/alerts", body, Alert),
    patch: (id: string, body: AlertPatch) => client.patch(`/v1/alerts/${enc(id)}`, body, Alert),
    remove: (id: string) => client.delete(`/v1/alerts/${enc(id)}`),
    trigger: (id: string, body: AlertTrigger) => client.post(`/v1/alerts/${enc(id)}/trigger`, body, Alert),
  };
}
const f = alertFetchers();

export function useAlerts(enabled = true) {
  return useQuery({ queryKey: alertKeys.list, queryFn: () => f.list(), staleTime: 30_000, enabled });
}

function useAlertMutation<TVars>(run: (vars: TVars) => Promise<Alert>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (a: Alert) => {
      // patch the cached list first so the bell and the rows move without waiting for the refetch
      qc.setQueryData<Alert[]>(alertKeys.list, (prev) => (prev ? (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [a, ...prev]) : prev));
      void qc.invalidateQueries({ queryKey: alertKeys.all });
    },
  });
}

export function useCreateAlert() {
  return useAlertMutation((body: AlertCreate) => f.create(body));
}
export function usePatchAlert() {
  return useAlertMutation(({ id, body }: { id: string; body: AlertPatch }) => f.patch(id, body));
}
export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => f.remove(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<Alert[]>(alertKeys.list, (prev) => prev?.filter((x) => x.id !== id));
      void qc.invalidateQueries({ queryKey: alertKeys.all });
    },
  });
}
export function useTriggerAlert() {
  return useAlertMutation(({ id, body }: { id: string; body: AlertTrigger }) => f.trigger(id, body));
}

// Autopilot through TanStack Query (ADR-108, ADR-109; HC-TR-219): the trader's switch, the playbooks switched on with
// their exit style, and the log of what Autopilot did. Paper only.
import { AutopilotResults, type AutopilotSettings, AutopilotView } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";
import { strategyKeys } from "./strategies";

export const autopilotKeys = {
  view: () => ["autopilot", "view"] as const,
  results: () => ["autopilot", "results"] as const,
};

export function autopilotFetchers(client: ApiClient = api) {
  return {
    view: () => client.get("/v1/autopilot", AutopilotView),
    results: () => client.get("/v1/autopilot/results", AutopilotResults),
    save: (settings: AutopilotSettings) => client.put("/v1/autopilot", settings, AutopilotView),
  };
}
const f = autopilotFetchers();

/** How often a screen re-reads what the server does by itself: the engine writes after each market snapshot. */
export const AUTOPILOT_POLL_MS = 60_000;

/**
 * The view is re-read every minute while a screen shows it. `poll: "on"` re-reads only while Autopilot is switched
 * on (the Desk's status bar: a trader who never used it costs one read).
 */
export function useAutopilot(poll: "always" | "on" = "always") {
  return useQuery({ queryKey: autopilotKeys.view(), queryFn: () => f.view(), staleTime: 30_000, refetchInterval: (q) => (poll === "always" || q.state.data?.settings.enabled ? AUTOPILOT_POLL_MS : false) });
}

/** What Autopilot's trades came to (ADR-111): re-read with the log, a trade closes whenever the server's rules say so. */
export function useAutopilotResults() {
  return useQuery({ queryKey: autopilotKeys.results(), queryFn: () => f.results(), staleTime: 30_000, refetchInterval: AUTOPILOT_POLL_MS });
}

export function useSaveAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: AutopilotSettings) => f.save(settings),
    onSuccess: (v: AutopilotView) => {
      qc.setQueryData<AutopilotView>(autopilotKeys.view(), v);
      void qc.invalidateQueries({ queryKey: strategyKeys.all });
    },
  });
}

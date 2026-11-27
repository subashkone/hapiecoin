// The trader's mandates for live Autopilot through TanStack Query (ADR-147, ADR-149; HC-TR-307, HC-TR-308): read, sign,
// pause, resume, end. Signing and resuming carry the authenticator code in its header; nothing here places an order.
import { Mandate, MandateList, type MandateSign } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autopilotKeys } from "./autopilot";
import { api, type ApiClient } from "./client";
import { secondFactorHeaders } from "./second-factor";

const BASE = "/v1/autopilot/mandates";
export const mandateKeys = { mine: ["autopilot", "mandates"] as const };
export type MandateStep = "pause" | "resume" | "end";

export function mandateFetchers(client: ApiClient = api) {
  const coded = (code: string | undefined) => (secondFactorHeaders(code) ? { headers: secondFactorHeaders(code)! } : {});
  return {
    list: () => client.get(BASE, MandateList),
    // (what the trader ticked and typed goes as it is: the server refuses a statement that is not true and a wrong word)
    sign: (body: MandateSign, code: string | undefined) => client.request(BASE, { method: "POST", body, schema: Mandate, ...coded(code) }),
    step: (id: string, step: MandateStep, code?: string) => client.request(`${BASE}/${encodeURIComponent(id)}/${step}`, { method: "POST", body: {}, schema: Mandate, ...coded(code) }),
  };
}
const f = mandateFetchers();

/** The trader's mandates, newest first, ended ones included. Read again every half minute: a mandate can be paused by the server. */
export function useMandates(enabled = true) {
  return useQuery({ queryKey: mandateKeys.mine, queryFn: async () => (await f.list()).items, staleTime: 10_000, refetchInterval: 30_000, enabled });
}
function useMandateMutation<TVars>(run: (vars: TVars) => Promise<Mandate>) {
  const qc = useQueryClient();
  // settled, not only on success: a refusal often means the mandate is not what this screen last read
  return useMutation({ mutationFn: run, onSettled: () => { void qc.invalidateQueries({ queryKey: mandateKeys.mine }); void qc.invalidateQueries({ queryKey: autopilotKeys.view() }); } });
}
export function useSignMandate() {
  return useMandateMutation(({ body, code }: { body: MandateSign; code?: string | undefined }) => f.sign(body, code));
}
export function useMandateStep() {
  return useMandateMutation(({ id, step, code }: { id: string; step: MandateStep; code?: string | undefined }) => f.step(id, step, code));
}

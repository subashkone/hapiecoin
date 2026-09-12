// Server data through TanStack Query (typescript rule 5). Keys are typed factories; mutations are
// optimistic and roll back on error. Components never call fetch directly.
import { Broker, BrokerCredentialPublic, User, UserSettings, paginated } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";
import {
  ConnectCredentialBody,
  CredentialResponse,
  PlanState,
  ProfileUpdate,
  WhitelistIp,
  type ConnectCredentialBody as ConnectBody,
  type ProfileUpdate as ProfileUpdateT,
} from "./schemas";

export const queryKeys = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  brokers: ["brokers"] as const,
  credential: ["credential"] as const,
  whitelistIp: ["credential", "whitelist-ip"] as const,
  plan: ["plan"] as const,
};

const BrokerPage = paginated(Broker);
const BrokerOrList = z.union([BrokerPage, z.array(Broker)]);

/** Accepts either a paginated envelope or a bare array (the API contract allows either for small lists). */
export function toBrokerArray(v: z.infer<typeof BrokerOrList>): Broker[] {
  return Array.isArray(v) ? v : v.items;
}

export function fetchers(client: ApiClient = api) {
  return {
    me: () => client.get("/v1/me", User),
    settings: () => client.get("/v1/settings", UserSettings),
    brokers: async () => toBrokerArray(await client.get("/v1/brokers", BrokerOrList)),
    credential: () => client.get("/v1/credentials", CredentialResponse),
    whitelistIp: () => client.get("/v1/credentials/whitelist-ip", WhitelistIp),
    plan: () => client.get("/v1/plan", PlanState),
    updateSettings: (patch: Partial<UserSettings>) =>
      client.put("/v1/settings", patch, UserSettings),
    updateProfile: (patch: ProfileUpdateT) => client.patch("/v1/me", ProfileUpdate.parse(patch), User),
    createBroker: (body: Omit<Broker, "id" | "scope">) => client.post("/v1/brokers", body, Broker),
    updateBroker: (id: string, body: Partial<Omit<Broker, "id" | "scope">>) =>
      client.patch(`/v1/brokers/${encodeURIComponent(id)}`, body, Broker),
    deleteBroker: (id: string) => client.delete(`/v1/brokers/${encodeURIComponent(id)}`),
    connect: (body: ConnectBody) =>
      client.post("/v1/credentials", ConnectCredentialBody.parse(body), BrokerCredentialPublic),
    disconnect: (id: string) => client.delete(`/v1/credentials/${encodeURIComponent(id)}`), // the key row (account), ADR-068
  };
}

const f = fetchers();

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: f.me, staleTime: 60_000 });
}
export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: f.settings, staleTime: 60_000 });
}
export function useBrokers() {
  return useQuery({ queryKey: queryKeys.brokers, queryFn: f.brokers, staleTime: 60_000 });
}
export function useCredential() {
  return useQuery({ queryKey: queryKeys.credential, queryFn: f.credential, staleTime: 30_000 });
}
export function useWhitelistIp() {
  return useQuery({ queryKey: queryKeys.whitelistIp, queryFn: f.whitelistIp, staleTime: Infinity });
}
export function usePlan() {
  return useQuery({ queryKey: queryKeys.plan, queryFn: f.plan, staleTime: 60_000 });
}

/** Optimistic settings update: the UI shows the new value at once and rolls back on failure. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.updateSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.settings });
      const previous = qc.getQueryData<UserSettings>(queryKeys.settings);
      if (previous) qc.setQueryData<UserSettings>(queryKeys.settings, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.settings, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.settings, data),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.updateProfile,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.me });
      const previous = qc.getQueryData<User>(queryKeys.me);
      if (previous) {
        const next: User = { ...previous, name: patch.name };
        if (patch.mobile !== undefined) next.mobile = patch.mobile;
        if (patch.avatar !== undefined) next.avatar = patch.avatar;
        qc.setQueryData<User>(queryKeys.me, next);
      }
      return { previous };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.me, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.me, data),
  });
}

export function useCreateBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.createBroker,
    onSuccess: (created) =>
      qc.setQueryData<Broker[]>(queryKeys.brokers, (list) => [...(list ?? []), created]),
  });
}

export function useUpdateBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Omit<Broker, "id" | "scope">> }) =>
      f.updateBroker(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: queryKeys.brokers });
      const previous = qc.getQueryData<Broker[]>(queryKeys.brokers);
      qc.setQueryData<Broker[]>(queryKeys.brokers, (list) =>
        (list ?? []).map((b) => (b.id === id ? { ...b, ...body } : b)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.brokers, ctx.previous);
    },
    onSuccess: (updated) =>
      qc.setQueryData<Broker[]>(queryKeys.brokers, (list) =>
        (list ?? []).map((b) => (b.id === updated.id ? updated : b)),
      ),
  });
}

export function useDeleteBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.deleteBroker,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.brokers });
      const previous = qc.getQueryData<Broker[]>(queryKeys.brokers);
      qc.setQueryData<Broker[]>(queryKeys.brokers, (list) => (list ?? []).filter((b) => b.id !== id));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.brokers, ctx.previous);
    },
  });
}

export function useConnectExchange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.connect,
    onSuccess: (created) =>
      qc.setQueryData<CredentialResponse>(queryKeys.credential, (prev) => ({
        items: [...(prev?.items ?? []).filter((c) => c.id !== created.id), created], // a replaced key keeps its id; a new label is one more account (ADR-068)
      })),
  });
}

export function useDisconnectExchange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: f.disconnect,
    onSuccess: (_void, id) => {
      qc.setQueryData<CredentialResponse>(queryKeys.credential, (prev) => ({
        items: (prev?.items ?? []).filter((c) => c.id !== id), // one key row (account) goes, the broker's others stay (ADR-068)
      }));
      void qc.invalidateQueries({ queryKey: ["strategies"] }); // the strategies that named the key come back without it
    },
  });
}

/** Drop every cached server value (logout). */
export function clearServerCache(qc: QueryClient) {
  qc.clear();
}

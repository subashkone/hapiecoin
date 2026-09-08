// Plans, subscription and the admin masters through TanStack Query (Phase 4 item 1, ADR-030).
import { type ActivateBody, type AdminUserPatch, AdminUserRow, AdminUsersPage, type BulkActiveBody, MenuItem, type MenuItemInput, MenuItemList, Plan, type PlanInput, PlanList, SubscriptionView } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";
import { queryKeys } from "./queries";

const enc = encodeURIComponent;
export const billingKeys = {
  subscription: ["subscription"] as const,
  plans: ["plans"] as const,
  adminPlans: ["admin", "plans"] as const,
  adminMenuItems: ["admin", "menu-items"] as const,
  adminUsers: (q: string, status: string, page: number) => ["admin", "users", q, status, page] as const,
  adminUsersAll: ["admin", "users"] as const,
};

export function billingFetchers(client: ApiClient = api) {
  return {
    subscription: () => client.get("/v1/subscription", SubscriptionView),
    plans: () => client.get("/v1/plans", PlanList),
    activate: (body: ActivateBody) => client.post("/v1/subscription/activate", body, SubscriptionView),
    adminPlans: () => client.get("/v1/admin/plans", PlanList),
    createPlan: (body: PlanInput) => client.post("/v1/admin/plans", body, Plan),
    updatePlan: (id: string, body: PlanInput) => client.patch(`/v1/admin/plans/${enc(id)}`, body, Plan),
    bulkPlans: (body: BulkActiveBody) => client.post("/v1/admin/plans/bulk", body, PlanList),
    adminMenuItems: () => client.get("/v1/admin/menu-items", MenuItemList),
    createMenuItem: (body: MenuItemInput) => client.post("/v1/admin/menu-items", body, MenuItem),
    updateMenuItem: (id: string, body: MenuItemInput) => client.patch(`/v1/admin/menu-items/${enc(id)}`, body, MenuItem),
    bulkMenuItems: (body: BulkActiveBody) => client.post("/v1/admin/menu-items/bulk", body, MenuItemList),
    adminUsers: (q: string, status: string, page: number) => client.get(`/v1/admin/users?q=${enc(q)}&status=${enc(status)}&page=${page}`, AdminUsersPage),
    patchUser: (id: string, body: AdminUserPatch) => client.patch(`/v1/admin/users/${enc(id)}`, body, AdminUserRow),
    bulkUsers: (body: BulkActiveBody) => client.post("/v1/admin/users/bulk", body, z.object({ updated: z.number().int() })),
  };
}
const f = billingFetchers();

export function useSubscription() {
  return useQuery({ queryKey: billingKeys.subscription, queryFn: f.subscription, staleTime: 30_000 });
}
export function usePlans() {
  return useQuery({ queryKey: billingKeys.plans, queryFn: async () => (await f.plans()).items, staleTime: 5 * 60_000 });
}
export function useActivatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivateBody) => f.activate(body),
    onSuccess: (view) => {
      qc.setQueryData(billingKeys.subscription, view);
      void qc.invalidateQueries({ queryKey: queryKeys.plan });
      void qc.invalidateQueries({ queryKey: billingKeys.adminUsersAll });
    },
  });
}

function useAdminMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>, keys: readonly (readonly string[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    },
  });
}
export function useAdminPlans() {
  return useQuery({ queryKey: billingKeys.adminPlans, queryFn: async () => (await f.adminPlans()).items, staleTime: 15_000 });
}
export function useCreatePlan() {
  return useAdminMutation((body: PlanInput) => f.createPlan(body), [billingKeys.adminPlans, billingKeys.plans, billingKeys.subscription, billingKeys.adminMenuItems]);
}
export function useUpdatePlan() {
  return useAdminMutation(({ id, body }: { id: string; body: PlanInput }) => f.updatePlan(id, body), [billingKeys.adminPlans, billingKeys.plans, billingKeys.subscription, billingKeys.adminMenuItems]);
}
export function useBulkPlans() {
  return useAdminMutation((body: BulkActiveBody) => f.bulkPlans(body), [billingKeys.adminPlans, billingKeys.plans, billingKeys.subscription]);
}
export function useAdminMenuItems() {
  return useQuery({ queryKey: billingKeys.adminMenuItems, queryFn: async () => (await f.adminMenuItems()).items, staleTime: 15_000 });
}
export function useCreateMenuItem() {
  return useAdminMutation((body: MenuItemInput) => f.createMenuItem(body), [billingKeys.adminMenuItems]);
}
export function useUpdateMenuItem() {
  return useAdminMutation(({ id, body }: { id: string; body: MenuItemInput }) => f.updateMenuItem(id, body), [billingKeys.adminMenuItems, billingKeys.subscription]);
}
export function useBulkMenuItems() {
  return useAdminMutation((body: BulkActiveBody) => f.bulkMenuItems(body), [billingKeys.adminMenuItems, billingKeys.subscription]);
}
export function useAdminUsers(q: string, status: string, page: number) {
  return useQuery({ queryKey: billingKeys.adminUsers(q, status, page), queryFn: () => f.adminUsers(q, status, page), staleTime: 10_000, placeholderData: (prev) => prev });
}
export function usePatchAdminUser() {
  return useAdminMutation(({ id, body }: { id: string; body: AdminUserPatch }) => f.patchUser(id, body), [billingKeys.adminUsersAll, billingKeys.subscription]);
}
export function useBulkAdminUsers() {
  return useAdminMutation((body: BulkActiveBody) => f.bulkUsers(body), [billingKeys.adminUsersAll]);
}

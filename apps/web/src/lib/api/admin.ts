// Admin · User Management through TanStack Query (Phase 4 item 4a, ADR-032): the list with search / filters /
// sort / paging, the drawer detail, comped plan changes, invitations. Patch and bulk activate stay in billing.ts.
import { AdminUserDetail, AdminUserRow, AdminUsersPage, type AdminUsersQuery, type BulkPlanBody, BulkPlanResult, type InviteUserBody, type SetPlanBody } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";
import { billingKeys } from "./billing";
import { referralKeys } from "./referrals";

const enc = encodeURIComponent;
export type UsersListQuery = Required<Pick<AdminUsersQuery, "status" | "plan" | "sort" | "dir" | "page">> & { q: string };
export const DEFAULT_USERS_QUERY: UsersListQuery = { q: "", status: "all", plan: "all", sort: "createdAt", dir: "desc", page: 1 };

export const adminKeys = {
  users: (q: UsersListQuery) => ["admin", "users", "list", q.q, q.status, q.plan, q.sort, q.dir, q.page] as const,
  detail: (id: string) => ["admin", "users", "detail", id] as const,
};

export function adminFetchers(client: ApiClient = api) {
  return {
    users: (q: UsersListQuery) => client.get(`/v1/admin/users?q=${enc(q.q)}&status=${enc(q.status)}&plan=${enc(q.plan)}&sort=${enc(q.sort)}&dir=${enc(q.dir)}&page=${q.page}`, AdminUsersPage),
    detail: (id: string) => client.get(`/v1/admin/users/${enc(id)}`, AdminUserDetail),
    setPlan: (id: string, body: SetPlanBody) => client.post(`/v1/admin/users/${enc(id)}/plan`, body, AdminUserRow),
    bulkPlan: (body: BulkPlanBody) => client.post("/v1/admin/users/bulk-plan", body, BulkPlanResult),
    invite: (body: InviteUserBody) => client.post("/v1/admin/users/invite", body, AdminUserRow),
  };
}
const f = adminFetchers();

export function useAdminUsersList(q: UsersListQuery) {
  return useQuery({ queryKey: adminKeys.users(q), queryFn: () => f.users(q), staleTime: 10_000, placeholderData: (prev) => prev });
}
export function useAdminUserDetail(id: string | null) {
  return useQuery({ queryKey: adminKeys.detail(id ?? ""), queryFn: () => f.detail(id ?? ""), enabled: id !== null, staleTime: 5_000 });
}
function useUsersMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.adminUsersAll });
      void qc.invalidateQueries({ queryKey: referralKeys.adminAll });
    },
  });
}
export function useSetPlan() {
  return useUsersMutation(({ id, body }: { id: string; body: SetPlanBody }) => f.setPlan(id, body));
}
export function useBulkPlan() {
  return useUsersMutation((body: BulkPlanBody) => f.bulkPlan(body));
}
export function useInviteUser() {
  return useUsersMutation((body: InviteUserBody) => f.invite(body));
}

/** Status of a row as the admin reads it (HC-AD-087). */
export function userStatus(u: AdminUserRow, now = Date.now()): { key: "deactivated" | "active" | "expired" | "free"; label: string } {
  if (!u.active) return { key: "deactivated", label: "Deactivated" };
  if (u.planName === null) return { key: "free", label: "Free" };
  if (u.expiresAt !== null && new Date(u.expiresAt).getTime() <= now) return { key: "expired", label: "Expired" };
  return { key: "active", label: "Active" };
}

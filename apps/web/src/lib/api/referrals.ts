// Referrals and commissions through TanStack Query (Phase 4 item 3, ADR-031).
import { AdminCommissionDetail, AdminCommissionsView, type BulkPayBody, BulkPayResult, type MarkPaymentBody, ReferralsView } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";

const enc = encodeURIComponent;
export const referralKeys = {
  mine: ["referrals"] as const,
  admin: (q: string, month: string) => ["admin", "commissions", q, month] as const,
  adminAll: ["admin", "commissions"] as const,
  detail: (id: string) => ["admin", "commissions", "detail", id] as const,
};
const MarkResult = z.object({ rows: z.number().int(), amountInr: z.string() });

export function referralFetchers(client: ApiClient = api) {
  return {
    mine: () => client.get("/v1/referrals", ReferralsView),
    admin: (q: string, month: string) => client.get(`/v1/admin/commissions?q=${enc(q)}${month ? `&month=${enc(month)}` : ""}`, AdminCommissionsView),
    detail: (id: string) => client.get(`/v1/admin/commissions/${enc(id)}`, AdminCommissionDetail),
    mark: (id: string, body: MarkPaymentBody) => client.post(`/v1/admin/commissions/${enc(id)}/mark`, body, MarkResult),
    bulkPay: (body: BulkPayBody) => client.post("/v1/admin/commissions/bulk-pay", body, BulkPayResult),
  };
}
const f = referralFetchers();

export function useReferrals() {
  return useQuery({ queryKey: referralKeys.mine, queryFn: f.mine, staleTime: 30_000 });
}
export function useAdminCommissions(q: string, month: string) {
  return useQuery({ queryKey: referralKeys.admin(q, month), queryFn: () => f.admin(q, month), staleTime: 10_000, placeholderData: (prev) => prev });
}
export function useCommissionDetail(id: string | null) {
  return useQuery({ queryKey: referralKeys.detail(id ?? ""), queryFn: () => f.detail(id ?? ""), enabled: id !== null, staleTime: 10_000 });
}
function useCommissionMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: referralKeys.adminAll });
      void qc.invalidateQueries({ queryKey: referralKeys.mine });
    },
  });
}
export function useMarkPayment() {
  return useCommissionMutation(({ id, body }: { id: string; body: MarkPaymentBody }) => f.mark(id, body));
}
export function useBulkPay() {
  return useCommissionMutation((body: BulkPayBody) => f.bulkPay(body));
}

/** Share message templates (HC-AC-069). */
export function shareTemplates(link: string, code: string, pct: string): { key: "whatsapp" | "x" | "email"; label: string; text: string; href: string }[] {
  const msg = `I use HapieCoin for BTC, ETH and XAUT options on Delta Exchange India: live chain, strategy builder, paper and live trading. Sign up with my link ${link} (code ${code}).`;
  return [
    { key: "whatsapp", label: "WhatsApp", text: msg, href: `https://wa.me/?text=${enc(msg)}` },
    { key: "x", label: "X", text: `${msg.slice(0, 200)}`, href: `https://twitter.com/intent/tweet?text=${enc(msg.slice(0, 200))}` },
    { key: "email", label: "Email", text: `Subject: Try HapieCoin\n\n${msg}\n\nYou get ${pct}% off nothing, I get ${pct}% commission when you subscribe. Fair trade.`, href: `mailto:?subject=${enc("Try HapieCoin")}&body=${enc(msg)}` },
  ];
}

/** CSV of the visible referral rows (HC-AC-071). */
export function referralsCsv(rows: ReferralsView["rows"]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["Name", "Email", "Joined", "Plan", "Interval", "Amount", "Commission", "Status"].join(",");
  return [head, ...rows.map((r) => [r.name, r.email, r.joinedAt.slice(0, 10), r.planName ?? "", r.interval ?? "", r.amountInr, r.commissionInr, r.status].map(esc).join(","))].join("\n");
}

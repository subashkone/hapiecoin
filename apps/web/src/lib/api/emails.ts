// Promotional emails through TanStack Query (Phase 4 item 4c, ADR-035): recipients, send, test send, history.
import { CampaignDetail, CampaignList, type EmailSegment, RecipientList, type SendEmailBody, SendEmailResult, type TestEmailBody } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";

const enc = encodeURIComponent;
export const emailKeys = {
  recipients: (q: string, segment: EmailSegment) => ["admin", "emails", "recipients", q, segment] as const,
  campaigns: ["admin", "emails", "campaigns"] as const,
  campaign: (id: string) => ["admin", "emails", "campaign", id] as const,
};
const TestResult = z.object({ email: z.string(), subject: z.string() });

export function emailFetchers(client: ApiClient = api) {
  return {
    recipients: (q: string, segment: EmailSegment) => client.get(`/v1/admin/emails/recipients?q=${enc(q)}&segment=${segment}`, RecipientList),
    send: (body: SendEmailBody) => client.post("/v1/admin/emails/send", body, SendEmailResult),
    test: (body: TestEmailBody) => client.post("/v1/admin/emails/test", body, TestResult),
    campaigns: () => client.get("/v1/admin/emails/campaigns", CampaignList),
    campaign: (id: string) => client.get(`/v1/admin/emails/campaigns/${enc(id)}`, CampaignDetail),
  };
}
const f = emailFetchers();

export function useRecipients(q: string, segment: EmailSegment) {
  return useQuery({ queryKey: emailKeys.recipients(q, segment), queryFn: () => f.recipients(q, segment), staleTime: 10_000, placeholderData: (prev) => prev });
}
export function useCampaigns() {
  return useQuery({ queryKey: emailKeys.campaigns, queryFn: async () => (await f.campaigns()).items, staleTime: 10_000 });
}
export function useCampaign(id: string | null) {
  return useQuery({ queryKey: emailKeys.campaign(id ?? ""), queryFn: () => f.campaign(id ?? ""), enabled: id !== null, staleTime: 60_000 });
}
export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: SendEmailBody) => f.send(body), onSuccess: () => void qc.invalidateQueries({ queryKey: emailKeys.campaigns }) });
}
export function useTestSend() {
  return useMutation({ mutationFn: (body: TestEmailBody) => f.test(body) });
}

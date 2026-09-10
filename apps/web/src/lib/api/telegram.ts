// Telegram linking for alert delivery (ADR-057): status, a link code with the bot deep link, unlink, a test message.
import { TelegramStatus } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";

export const telegramKeys = { status: ["me", "telegram"] as const };

export function telegramFetchers(client: ApiClient = api) {
  return {
    status: () => client.get("/v1/me/telegram", TelegramStatus),
    link: () => client.post("/v1/me/telegram/link", {}, TelegramStatus),
    unlink: () => client.delete("/v1/me/telegram"),
    test: () => client.post("/v1/me/telegram/test", {}, z.object({ ok: z.literal(true) })),
  };
}
const f = telegramFetchers();

/** Polls every 3 s while a link is pending so the dialog flips to "connected" as soon as Start is pressed. */
export function useTelegramStatus(enabled = true) {
  return useQuery({
    queryKey: telegramKeys.status,
    queryFn: () => f.status(),
    enabled,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.pending ? 3_000 : false),
  });
}

function useStatusMutation<T>(run: () => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (r) => {
      if (r && typeof r === "object" && "linked" in r) qc.setQueryData(telegramKeys.status, r);
      void qc.invalidateQueries({ queryKey: telegramKeys.status });
    },
  });
}
export const useLinkTelegram = () => useStatusMutation(() => f.link());
export const useUnlinkTelegram = () => useStatusMutation(() => f.unlink());
export const useTestTelegram = () => useMutation({ mutationFn: () => f.test() });

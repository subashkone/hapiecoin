// Server-side session check: forwards the browser's cookie to apps/api `/v1/me`. Used by protected
// layouts (redirect to /auth?next=…) and by /auth (redirect away when already signed in).
import "server-only";
import { User } from "@hapiecoin/schema";
import { headers } from "next/headers";
import { createApiClient, ApiError } from "@/lib/api/client";
import { serverEnv } from "@/lib/env";

export async function getServerUser(): Promise<User | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;
  const client = createApiClient({ baseUrl: serverEnv().API_URL, headers: { cookie } });
  try {
    return await client.get("/v1/me", User);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    // API unreachable: treat as signed out rather than crashing the page; the client will retry.
    return null;
  }
}

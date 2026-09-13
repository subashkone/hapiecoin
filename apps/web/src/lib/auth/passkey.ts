// Passkeys (GAPS #12, ADR-089; HC-SH-137, HC-PB-069). The passkey client plugin brings the WebAuthn library with it, so
// it lives in its own client, created on first use behind a dynamic import: the workspace's first load stays as it
// is (GAPS #19) and only the sign-in screen and the Security dialog pay for it, when a passkey is used.
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

function createPasskeyClient() {
  return createAuthClient({
    plugins: [passkeyClient()],
    fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
  });
}
export type PasskeyClient = ReturnType<typeof createPasskeyClient>;

let client: PasskeyClient | null = null;
/** The passkey-capable auth client, one per page. */
export function passkeyAuth(): PasskeyClient {
  client ??= createPasskeyClient();
  return client;
}

/** The browser can create and use passkeys at all (WebAuthn present). */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.create === "function";
}

/** A passkey as the plugin lists it. */
export interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  deviceType?: string;
  backedUp?: boolean;
}

// Shared test utilities: fetch routed into the Hono mock API with a cookie jar, a scriptable fake WebSocket,
// and a render wrapper with every provider the components expect.
import { DensityProvider, ThemeProvider, Toaster, TooltipProvider } from "@hapiecoin/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, within, type RenderOptions } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { GatewayClient, type WebSocketLike } from "@/lib/gateway/client";
import { GatewayProvider } from "@/lib/gateway/hooks";
import { createMockApi, createAccount, createSession, SESSION_COOKIE, type MockState } from "./mock-api";

/* ---------------- mock fetch ---------------- */

export interface MockFetch {
  app: ReturnType<typeof createMockApi>["app"];
  state: MockState;
  /** Requests seen, oldest first. */
  calls: { url: string; method: string; body: string | undefined; headers: Record<string, string> }[];
  /** Sign a seeded user in by planting the session cookie in the jar. */
  loginAs: (email: string, opts?: { role?: "user" | "admin"; connected?: boolean }) => void;
  restore: () => void;
}

/** Route `fetch` into the in-memory mock API. Relative and absolute URLs both work. */
export function installMockFetch(): MockFetch {
  const { app, state } = createMockApi();
  const jar = new Map<string, string>();
  const calls: MockFetch["calls"] = [];
  const original = globalThis.fetch;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : input instanceof URL ? input.href : typeof input === "string" ? input : "";
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? req?.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    let body: BodyInit | null | undefined = init?.body;
    if (req && body === undefined && method !== "GET" && method !== "HEAD") body = await req.text();
    calls.push({ url, method, body: typeof body === "string" ? body : undefined, headers: Object.fromEntries(headers.entries()) });
    const absolute = /^https?:/.test(url) ? url : `http://localhost${url.startsWith("/") ? "" : "/"}${url}`;
    const res = await app.request(absolute, { method, headers, ...(body !== undefined && body !== null ? { body } : {}) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const [k, v] = (pair ?? "").split("=");
      if (!k) continue;
      if (sc.toLowerCase().includes("max-age=0") || !v) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    return res;
  };
  globalThis.fetch = vi.fn(impl);
  return {
    app,
    state,
    calls,
    loginAs: (email, opts = {}) => {
      if (!state.accounts.has(email.toLowerCase())) {
        const acc = createAccount(state, { email, ...(opts.role ? { role: opts.role } : {}) });
        if (opts.connected) {
          acc.credentials.push({
            id: "crd_main",
            label: "Main",
            brokerId: "brk_delta",
            apiKeyMasked: "****ab12",
            connectedAt: "2026-09-07T10:00:00.000Z",
            whitelistedIp: "172.236.179.136",
          });
        }
      }
      jar.set(SESSION_COOKIE, createSession(state, email));
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/* ---------------- fake WebSocket ---------------- */

export class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
  /** Test controls. */
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  sentFrames(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }
  static reset() {
    FakeSocket.instances = [];
  }
  static last(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!s) throw new Error("no FakeSocket created yet");
    return s;
  }
}

export function makeGateway(opts: Partial<ConstructorParameters<typeof GatewayClient>[0]> = {}) {
  return new GatewayClient({
    url: "ws://test",
    createSocket: (url) => new FakeSocket(url),
    pingIntervalMs: 0,
    backoffBaseMs: 10,
    backoffMaxMs: 40,
    ...opts,
  });
}

/* ---------------- render ---------------- */

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  gateway?: GatewayClient;
  queryClient?: QueryClient;
}

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function renderWithProviders(ui: ReactElement, opts: RenderWithProvidersOptions = {}) {
  const queryClient = opts.queryClient ?? makeQueryClient();
  const gateway = opts.gateway ?? makeGateway();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider defaultTheme="dark">
      <DensityProvider>
        <QueryClientProvider client={queryClient}>
          <GatewayProvider url="ws://test" client={gateway}>
            <TooltipProvider>{children}</TooltipProvider>
          </GatewayProvider>
        </QueryClientProvider>
        <Toaster />
      </DensityProvider>
    </ThemeProvider>
  );
  const rest: RenderOptions = { ...opts };
  delete (rest as Partial<RenderWithProvidersOptions>).gateway;
  delete (rest as Partial<RenderWithProvidersOptions>).queryClient;
  return { ...render(ui, { wrapper, ...rest }), queryClient, gateway };
}

/** Flush microtasks + a macrotask so effects and query resolutions settle. */
export const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/** HC-TR-186: a live confirm needs the word typed first; a paper dialog has no field, so this is a no-op there. */
export async function typeLiveIf(u: ReturnType<typeof userEvent.setup>, scope: HTMLElement): Promise<void> {
  const f = within(scope).queryByTestId<HTMLInputElement>("live-confirm");
  if (f && !f.disabled) {
    await u.clear(f);
    await u.type(f, "LIVE");
  }
}

/* ---------------- WebAuthn stub (ADR-089) ---------------- */

/** base64url of a short ASCII string, the way the browser reports a credential id. */
function b64url(text: string): string {
  return Buffer.from(text).toString("base64url");
}

/**
 * jsdom has no `navigator.credentials`: this puts one in that answers `create` and `get` with a credential-shaped object
 * the WebAuthn client library accepts, whose id is base64url(`credentialId`). Returns the id the mock will record,
 * and a restore. The `PublicKeyCredential` constructor is defined so the support check passes.
 */
export function installFakeWebAuthn(credentialId = "fake-credential-1") {
  const enc = new TextEncoder();
  const buf = (text: string): ArrayBuffer => enc.encode(text).buffer;
  const id = b64url(credentialId);
  const credential = (kind: "create" | "get") => ({
    id,
    rawId: buf(credentialId),
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    response:
      kind === "create"
        ? { clientDataJSON: buf("{}"), attestationObject: buf("attestation"), getTransports: () => ["internal"], getPublicKeyAlgorithm: () => -7, getPublicKey: () => buf("public-key"), getAuthenticatorData: () => buf("authenticator-data") }
        : { clientDataJSON: buf("{}"), authenticatorData: buf("authenticator-data"), signature: buf("signature"), userHandle: null },
  });
  const credentials = {
    create: vi.fn(() => Promise.resolve(credential("create"))),
    get: vi.fn(() => Promise.resolve(credential("get"))),
  };
  const hadPkc = Object.getOwnPropertyDescriptor(window, "PublicKeyCredential");
  const hadCreds = Object.getOwnPropertyDescriptor(navigator, "credentials");
  Object.defineProperty(window, "PublicKeyCredential", { value: function PublicKeyCredential() {}, configurable: true, writable: true });
  Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });
  return {
    credentialId: id,
    credentials,
    restore() {
      if (hadPkc) Object.defineProperty(window, "PublicKeyCredential", hadPkc);
      else delete (window as unknown as Record<string, unknown>)["PublicKeyCredential"];
      if (hadCreds) Object.defineProperty(navigator, "credentials", hadCreds);
      else delete (navigator as unknown as Record<string, unknown>)["credentials"];
    },
  };
}

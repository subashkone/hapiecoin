import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, makeQueryClient, type MockFetch } from "../../../test/helpers";
import {
  clearServerCache,
  fetchers,
  queryKeys,
  toBrokerArray,
  useBrokers,
  useConnectExchange,
  useCreateBroker,
  useCredential,
  useDeleteBroker,
  useDisconnectExchange,
  useMe,
  usePlan,
  useSettings,
  useUpdateBroker,
  useUpdateProfile,
  useUpdateSettings,
  useWhitelistIp,
} from "./queries";
import { createApiClient } from "./client";

let mock: MockFetch;
const EMAIL = "asha@example.com";
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
});
afterEach(() => mock.restore());

function setup() {
  const qc = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe("[API] queries and mutations against the mock API", () => {
  it("reads me / settings / brokers / credential / whitelist-ip / plan", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ me: useMe(), settings: useSettings(), brokers: useBrokers(), cred: useCredential(), ip: useWhitelistIp(), plan: usePlan() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.me.data?.email).toBe(EMAIL));
    await waitFor(() => expect(result.current.settings.data?.conversionRate).toBe("83.5"));
    await waitFor(() => expect(result.current.brokers.data?.[0]?.name).toBe("Delta Exchange India"));
    await waitFor(() => expect(result.current.cred.data?.items).toEqual([]));
    await waitFor(() => expect(result.current.ip.data?.ip).toBe("172.236.179.136"));
    await waitFor(() => expect(result.current.plan.data?.state).toBe("free"));
  });
  it("toBrokerArray accepts a bare array or a paginated envelope", () => {
    expect(toBrokerArray([])).toEqual([]);
    expect(toBrokerArray({ items: [], nextCursor: null })).toEqual([]);
  });
  it("updateSettings is optimistic and rolls back when the API rejects", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => ({ settings: useSettings(), update: useUpdateSettings() }), { wrapper });
    await waitFor(() => expect(result.current.settings.data).toBeDefined());
    // break the API: no session → 401 on PUT; slow it down so the optimistic value is observable
    mock.state.sessions.clear();
    const fast = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      await new Promise((r) => setTimeout(r, 60));
      return fast(...args);
    };
    act(() => result.current.update.mutate({ currency: "INR" }));
    await waitFor(() => expect(qc.getQueryData(queryKeys.settings)).toMatchObject({ currency: "INR" })); // optimistic
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.settings)).toMatchObject({ currency: "USD" }); // rolled back
  });
  it("updateProfile merges optimistically and stores the server response", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => ({ me: useMe(), update: useUpdateProfile() }), { wrapper });
    await waitFor(() => expect(result.current.me.data).toBeDefined());
    act(() => result.current.update.mutate({ name: "New Name", mobile: "9876543210", avatar: "diamond" }));
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(mock.calls.at(-1)).toMatchObject({ method: "PATCH" }); // /v1/me update verb
    expect(qc.getQueryData(queryKeys.me)).toMatchObject({ name: "New Name", mobile: "9876543210", avatar: "diamond" });
    mock.state.sessions.clear();
    act(() => result.current.update.mutate({ name: "Rolled" }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.me)).toMatchObject({ name: "New Name" });
  });
  it("broker create / update / delete keep the list in sync and roll back failures", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(
      () => ({ list: useBrokers(), create: useCreateBroker(), update: useUpdateBroker(), del: useDeleteBroker() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));
    act(() => result.current.create.mutate({ name: "CoinDCX", feePct: "0.1", gstPct: "18", feeCapPct: "10", venue: "delta_india" }));
    await waitFor(() => expect(qc.getQueryData(queryKeys.brokers)).toHaveLength(2));
    const created = (qc.getQueryData(queryKeys.brokers) as { id: string }[])[1]!;
    act(() => result.current.update.mutate({ id: created.id, body: { name: "CoinDCX Pro" } }));
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(mock.calls.at(-1)).toMatchObject({ method: "PATCH" }); // /v1/brokers/{id} update verb
    expect((qc.getQueryData(queryKeys.brokers) as { name: string }[])[1]?.name).toBe("CoinDCX Pro");
    // failing update rolls back
    act(() => result.current.update.mutate({ id: "missing", body: { name: "x" } }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.brokers)).toHaveLength(2);
    // failing delete (GLOBAL) rolls back
    act(() => result.current.del.mutate("brk_delta"));
    await waitFor(() => expect(result.current.del.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.brokers)).toHaveLength(2);
    act(() => result.current.del.mutate(created.id));
    await waitFor(() => expect(result.current.del.isSuccess).toBe(true));
    expect(qc.getQueryData(queryKeys.brokers)).toHaveLength(1);
  });
  it("connect / disconnect exchange update the credential cache; clearServerCache empties it", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => ({ cred: useCredential(), connect: useConnectExchange(), disconnect: useDisconnectExchange() }), { wrapper });
    await waitFor(() => expect(result.current.cred.isSuccess).toBe(true));
    act(() => result.current.connect.mutate({ brokerId: "brk_delta", apiKey: "key-abcd1234", apiSecret: "s" }));
    await waitFor(() => expect(result.current.connect.isSuccess).toBe(true));
    expect(qc.getQueryData(queryKeys.credential)).toMatchObject({ items: [{ apiKeyMasked: "****1234", brokerId: "brk_delta" }] });
    act(() => result.current.disconnect.mutate("brk_delta"));
    await waitFor(() => expect(result.current.disconnect.isSuccess).toBe(true));
    expect(qc.getQueryData(queryKeys.credential)).toEqual({ items: [] });
    expect(mock.calls.at(-1)?.method).toBe("DELETE");
    expect(mock.calls.at(-1)?.url).toContain("/v1/credentials/brk_delta");
    clearServerCache(qc);
    expect(qc.getQueryData(queryKeys.credential)).toBeUndefined();
  });
  it("fetchers can target another client (server-side use)", async () => {
    const f = fetchers(createApiClient({ baseUrl: "http://api.test" }));
    await expect(f.me()).resolves.toMatchObject({ email: EMAIL });
    mock.state.sessions.clear();
    await expect(f.plan()).rejects.toMatchObject({ status: 401 });
  });
});

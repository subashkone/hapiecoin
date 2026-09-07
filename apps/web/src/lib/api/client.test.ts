import { User } from "@hapiecoin/schema";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient, parseApiError } from "./client";

const user = {
  id: "usr_1",
  email: "a@b.co",
  name: "Asha",
  role: "user",
  avatar: "rocket",
  referralCode: "ASHA2026",
  createdAt: "2026-09-01T10:00:00Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("[API] fetch wrapper", () => {
  it("HC-SH-029 GET parses the body through the schema and sends credentials", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(user)));
    const api = createApiClient({ baseUrl: "http://api/", fetch, headers: { cookie: "s=1" } });
    const me = await api.get("/v1/me", User);
    expect(me.email).toBe("a@b.co");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/v1/me");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["cookie"]).toBe("s=1");
    expect(init.method).toBe("GET");
  });
  it("POST / PUT serialise JSON bodies; DELETE returns void", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
    const api = createApiClient({ fetch });
    await api.post("/v1/x", { a: 1 }, z.object({ ok: z.boolean() }));
    await api.put("/v1/x", { b: 2 });
    await api.delete("/v1/x");
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[1].method).toBe("POST");
    expect(calls[0]?.[1].body).toBe('{"a":1}');
    expect((calls[0]?.[1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(calls[1]?.[1].method).toBe("PUT");
    expect(calls[2]?.[1].method).toBe("DELETE");
    expect(calls[2]?.[1].body).toBeUndefined();
  });
  it("passes an AbortSignal through", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(user)));
    const api = createApiClient({ fetch });
    const ac = new AbortController();
    await api.get("/v1/me", User, ac.signal);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(ac.signal);
  });
  it("throws ApiError with the API's code/message on a structured error", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ code: "NOT_FOUND", message: "no such broker", details: { id: "x" } }, 404)));
    const api = createApiClient({ fetch });
    const err = await api.get("/v1/brokers/x", User).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND", message: "no such broker", details: { id: "x" } });
  });
  it("falls back to UNAUTHORIZED / NOT_FOUND / HTTP_ERROR codes for unstructured bodies", async () => {
    expect((await parseApiError(new Response("nope", { status: 401 }))).code).toBe("UNAUTHORIZED");
    expect((await parseApiError(new Response("nope", { status: 404 }))).code).toBe("NOT_FOUND");
    const e = await parseApiError(new Response("<html>", { status: 500, statusText: "Server Error" }));
    expect(e.code).toBe("HTTP_ERROR");
    expect(e.message).toBe("Server Error");
    const e2 = await parseApiError(new Response(null, { status: 502 }));
    expect(e2.message).toContain("502");
  });
  it("rejects a response that does not match the schema", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ id: "usr_1" })));
    const api = createApiClient({ fetch });
    const err = await api.get("/v1/me", User).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("INVALID_RESPONSE");
    expect((err as ApiError).details?.["issues"]).toBeDefined();
  });
  it("treats a 204 with an expected body as EMPTY_RESPONSE", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const api = createApiClient({ fetch });
    await expect(api.get("/v1/me", User)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });
});

// Razorpay client (ADR-034): basic-auth REST over a fake fetch, signature checks, and the test-environment refusal.
import { describe, expect, it } from "vitest";
import { FakeRazorpay, RazorpayHttpClient, hmacHex, safeEqual } from "./razorpay.js";

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } }));
  };
  return { fetch, calls };
}

describe("RazorpayHttpClient", () => {
  it("creates orders with basic auth and paise, reads payments, verifies both signatures, refuses the test env", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith("/v1/orders")) return { status: 200, body: { id: "order_1", amount: 80146, currency: "INR", status: "created" } };
      if (url.endsWith("/v1/payments/pay_ok")) return { status: 200, body: { id: "pay_ok", order_id: "order_1", amount: 80146, status: "captured", method: "upi" } };
      if (url.endsWith("/v1/payments/pay_missing")) return { status: 404, body: { error: { description: "not found" } } };
      return { status: 400, body: { error: { description: "bad request" } } };
    });
    const c = new RazorpayHttpClient({ keyId: "rzp_test_k", keySecret: "s3cret", webhookSecret: "wh", nodeEnv: "development", fetch });
    expect(c.keyId).toBe("rzp_test_k");
    const order = await c.createOrder({ amountPaise: 80146, currency: "INR", receipt: "pay_x", notes: { a: "b" } });
    expect(order).toEqual({ id: "order_1", amount: 80146, currency: "INR", status: "created" });
    const auth = new Headers(calls[0]?.init?.headers).get("authorization");
    expect(auth).toBe(`Basic ${Buffer.from("rzp_test_k:s3cret").toString("base64")}`);
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ amount: 80146, currency: "INR", receipt: "pay_x", notes: { a: "b" } });
    expect(await c.fetchPayment("pay_ok")).toMatchObject({ id: "pay_ok", order_id: "order_1", method: "upi", error_description: null });
    expect(await c.fetchPayment("pay_missing")).toBeNull();
    expect(c.verifyCheckout("order_1", "pay_ok", hmacHex("s3cret", "order_1|pay_ok"))).toBe(true);
    expect(c.verifyCheckout("order_1", "pay_ok", "nope")).toBe(false);
    expect(c.verifyWebhook("{}", hmacHex("wh", "{}"))).toBe(true);
    expect(c.verifyWebhook("{}", undefined)).toBe(false);
    const noHook = new RazorpayHttpClient({ keyId: "k", keySecret: "s", webhookSecret: undefined, nodeEnv: "development", fetch });
    expect(noHook.verifyWebhook("{}", hmacHex("wh", "{}"))).toBe(false);
    const failing = new RazorpayHttpClient({ keyId: "k", keySecret: "s", webhookSecret: undefined, nodeEnv: "development", fetch: fakeFetch(() => ({ status: 400, body: { error: { description: "bad request" } } })).fetch });
    await expect(failing.createOrder({ amountPaise: 1, currency: "INR", receipt: "r" })).rejects.toThrow(/Razorpay order failed \(400\): bad request/);
    expect(() => new RazorpayHttpClient({ keyId: "k", keySecret: "s", webhookSecret: undefined, nodeEnv: "test", fetch })).toThrow(/must not be used in tests/);
    expect(safeEqual("a", "ab")).toBe(false);
  });

  it("refuses order and payment responses without an id, and honours a base URL override", async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith("/v1/orders") ? { status: 200, body: { amount: 1 } } : url.endsWith("/pay_thin") ? { status: 200, body: { id: "pay_thin", amount: 1, status: "created" } } : { status: 200, body: { status: "captured" } }));
    const c = new RazorpayHttpClient({ keyId: "k", keySecret: "s", webhookSecret: undefined, nodeEnv: "development", fetch, baseUrl: "https://rzp.example" });
    await expect(c.createOrder({ amountPaise: 1, currency: "INR", receipt: "r" })).rejects.toThrow(/no details/);
    expect(await c.fetchPayment("pay_x")).toBeNull();
    expect(await c.fetchPayment("pay_thin")).toMatchObject({ id: "pay_thin", order_id: null, method: null, error_description: null });
    expect(calls[0]?.url).toBe("https://rzp.example/v1/orders");
  });

  it("times out a hung request", async () => {
    const hung = (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))); });
    const c = new RazorpayHttpClient({ keyId: "k", keySecret: "s", webhookSecret: undefined, nodeEnv: "development", fetch: hung, timeoutMs: 10 });
    await expect(c.fetchPayment("pay_slow")).rejects.toThrow(/aborted/);
  });

  it("FakeRazorpay signs the way the real one verifies", () => {
    const f = new FakeRazorpay();
    expect(f.verifyCheckout("o", "p", f.sign("o", "p"))).toBe(true);
    expect(f.verifyWebhook("body", f.signWebhook("body"))).toBe(true);
    expect(f.verifyWebhook("body", undefined)).toBe(false);
  });
});

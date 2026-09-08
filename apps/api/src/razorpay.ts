// Razorpay (Phase 4 item 2, ADR-034): the small surface HapieCoin uses, over plain fetch with basic auth (no SDK).
// Orders are created server-side from catalogue prices; signatures are HMAC-SHA256 as Razorpay documents:
// checkout: hmac(order_id + "|" + payment_id, key secret); webhook: hmac(raw body, webhook secret).
import { createHmac, timingSafeEqual } from "node:crypto";

export interface RazorpayOrderInput {
  amountPaise: number;
  currency: "INR";
  receipt: string;
  notes?: Record<string, string>;
}
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}
export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  status: string;
  method: string | null;
  error_description: string | null;
}
export interface RazorpayClient {
  readonly keyId: string;
  createOrder(input: RazorpayOrderInput): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment | null>;
  /** True when `signature` matches hmac(order_id|payment_id, key secret). */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  /** True when `signature` matches hmac(raw body, webhook secret); false when no webhook secret is configured. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Live client. Never constructed in tests (the harness uses FakeRazorpay); refused outright under NODE_ENV=test. */
export class RazorpayHttpClient implements RazorpayClient {
  private readonly auth: string;
  constructor(
    private readonly opts: { keyId: string; keySecret: string; webhookSecret: string | undefined; nodeEnv: string; baseUrl?: string; fetch?: FetchLike; timeoutMs?: number },
  ) {
    if (opts.nodeEnv === "test") throw new Error("RazorpayHttpClient must not be used in tests");
    this.auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;
  }
  get keyId(): string {
    return this.opts.keyId;
  }
  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
    const doFetch = this.opts.fetch ?? ((input, init) => fetch(input, init));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10_000);
    try {
      const res = await doFetch(`${this.opts.baseUrl ?? "https://api.razorpay.com"}${path}`, {
        method,
        headers: { authorization: this.auth, "content-type": "application/json", accept: "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as T | null;
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
  async createOrder(input: RazorpayOrderInput): Promise<RazorpayOrder> {
    const r = await this.call<RazorpayOrder & { error?: { description?: string } }>("POST", "/v1/orders", { amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: input.notes ?? {} });
    if (!r.ok || !r.data?.id) throw new Error(`Razorpay order failed (${r.status}): ${r.data?.error?.description ?? "no details"}`);
    return { id: r.data.id, amount: r.data.amount, currency: r.data.currency, status: r.data.status };
  }
  async fetchPayment(paymentId: string): Promise<RazorpayPayment | null> {
    const r = await this.call<RazorpayPayment>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);
    if (!r.ok || !r.data?.id) return null;
    return { id: r.data.id, order_id: r.data.order_id ?? null, amount: r.data.amount, status: r.data.status, method: r.data.method ?? null, error_description: r.data.error_description ?? null };
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqual(hmacHex(this.opts.keySecret, `${orderId}|${paymentId}`), signature);
  }
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.opts.webhookSecret || !signature) return false;
    return safeEqual(hmacHex(this.opts.webhookSecret, rawBody), signature);
  }
}

/** Test double: records orders, answers payments the test registers, signs with known secrets. */
export class FakeRazorpay implements RazorpayClient {
  readonly keyId = "rzp_test_fake";
  readonly keySecret = "fake_key_secret";
  readonly webhookSecret = "fake_webhook_secret";
  readonly orders: (RazorpayOrderInput & { id: string })[] = [];
  readonly payments = new Map<string, RazorpayPayment>();
  private seq = 0;
  createOrder(input: RazorpayOrderInput): Promise<RazorpayOrder> {
    this.seq += 1;
    const id = `order_fake${this.seq}`;
    this.orders.push({ ...input, id });
    return Promise.resolve({ id, amount: input.amountPaise, currency: input.currency, status: "created" });
  }
  fetchPayment(paymentId: string): Promise<RazorpayPayment | null> {
    return Promise.resolve(this.payments.get(paymentId) ?? null);
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqual(this.sign(orderId, paymentId), signature);
  }
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    return signature !== undefined && safeEqual(hmacHex(this.webhookSecret, rawBody), signature);
  }
  /** What checkout.js would hand back for a successful payment on `orderId`. */
  sign(orderId: string, paymentId: string): string {
    return hmacHex(this.keySecret, `${orderId}|${paymentId}`);
  }
  signWebhook(rawBody: string): string {
    return hmacHex(this.webhookSecret, rawBody);
  }
}

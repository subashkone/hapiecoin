/**
 * Delta Exchange India *private* trading client: the live executor (trading-safety rule 1). This is the only
 * module that may call order endpoints. ADR-025.
 *
 * Endpoints (docs.delta.exchange, verified 08 Sep 2026):
 *   GET    /v2/products/{symbol}            product id, contract_value, state (public, cached)
 *   GET    /v2/tickers/{symbol}             mark_price (public) for the placement band
 *   POST   /v2/orders                       { product_id, size, side, order_type: "market_order" | "limit_order", limit_price?, client_order_id, reduce_only }
 *   GET    /v2/orders/{order_id}
 *   GET    /v2/orders?product_ids=&states=  open / pending orders
 *   DELETE /v2/orders                       { id, product_id }
 *   GET    /v2/positions/margined
 *   GET    /v2/wallet/balances
 *   GET    /v2/fills?page_size=&after=      the account's fills, newest first, cursor-paged (read-only; verified P&L, ADR-073)
 *
 * Signing (docs "Authentication"): signature = hex(HMAC_SHA256(secret, method + timestamp + path + query + body)),
 * headers api-key / timestamp / signature / User-Agent; Delta rejects timestamps older than 5 s.
 *
 * Safety: refuses to run under NODE_ENV=test without an injected fetch (rule 2); 5 s timeout, a token bucket
 * spacing calls, and every order carries the caller's client_order_id so a retry cannot double-place (rule 4).
 * Order calls are never retried by this client: a timed-out placement is reported as `unknown` for the caller
 * to reconcile through `getOrder` / `listOpenOrders`.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { DeltaApiError } from "../errors.js";

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Build the signed request for `method path?query` (exported so the scheme is unit-testable). */
export function signDeltaRequest(opts: {
  baseUrl: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: string;
  body?: string;
  apiKey: string;
  apiSecret: string;
  timestamp: number;
}): SignedRequest {
  const query = opts.query ? (opts.query.startsWith("?") ? opts.query : `?${opts.query}`) : "";
  const ts = String(opts.timestamp);
  const payload = `${opts.method}${ts}${opts.path}${query}${opts.body ?? ""}`;
  const signature = createHmac("sha256", opts.apiSecret).update(payload).digest("hex");
  return {
    url: `${opts.baseUrl.replace(/\/+$/, "")}${opts.path}${query}`,
    headers: {
      "api-key": opts.apiKey,
      timestamp: ts,
      signature,
      "User-Agent": "hapiecoin-api",
      "Content-Type": "application/json",
    },
  };
}

export type TradingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface DeltaCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface DeltaTradingClientOptions {
  baseUrl: string;
  fetch?: TradingFetch;
  /** Unix seconds (default Date.now()/1000). */
  now?: () => number;
  timeoutMs?: number;
  nodeEnv?: string;
  /** Minimum spacing between private calls in ms (token bucket refill); default 100 ms ≈ 10 calls / s. */
  minIntervalMs?: number;
  /** Injectable sleep for the bucket (tests pass a recorder). */
  sleep?: (ms: number) => Promise<void>;
  /** Product cache lifetime (default 5 min). */
  productTtlMs?: number;
}

export type OrderSide = "buy" | "sell";
export type OrderState = "open" | "pending" | "closed" | "cancelled";

export type OrderType = "market" | "limit";

export interface PlaceOrderInput {
  productId: number;
  /** Number of contracts (whole number ≥ 1). */
  size: number;
  side: OrderSide;
  clientOrderId: string;
  reduceOnly?: boolean;
  /** Market (default) or a limit at `limitPrice` (ADR-044 adjustment entries); a limit that does not cross rests open. */
  orderType?: OrderType | undefined;
  limitPrice?: string | undefined;
}

export interface VenueOrder {
  id: number;
  clientOrderId: string | null;
  productId: number;
  side: OrderSide;
  size: number;
  unfilledSize: number;
  state: OrderState;
  /** Decimal string or null until something filled. */
  averageFillPrice: string | null;
}

/** One fill as the venue reports it (ADR-073): the trader's own trades, whether or not HapieCoin placed the order. */
export interface VenueFill {
  /** The venue's fill id, unique per account. */
  id: string;
  orderId: string | null;
  productId: number;
  symbol: string | null;
  side: OrderSide;
  /** Contracts. */
  size: number;
  /** Decimal string, the venue's quote unit. */
  price: string;
  /** Decimal string in the settling asset; "0" when the venue reports none. */
  commission: string;
  role: string | null;
  /** ISO instant. */
  filledAt: string;
  /** The venue's row as received (every field, for the first real shape and later disputes). */
  raw: unknown;
}
export interface FillsPage {
  fills: VenueFill[];
  /** Cursor for the next (older) page; null on the last page. */
  after: string | null;
}
export interface ListFillsOptions {
  after?: string | null | undefined;
  /** 1..100 (the venue's page cap). */
  pageSize?: number | undefined;
}

export interface VenueProduct {
  id: number;
  symbol: string;
  contractValue: string;
  contractType: string;
  state: string;
  /** Price increment of the product when the venue lists one (limit prices must sit on it). */
  tickSize?: string | undefined;
}

/** Snap a limit price onto the product's tick toward the passive side: a buy rounds down, a sell rounds up. Without a tick the price is returned as given. */
export function roundToTick(price: string, tickSize: string | undefined, side: OrderSide): string {
  const tick = Number(tickSize);
  const p = Number(price);
  if (!Number.isFinite(tick) || tick <= 0 || !Number.isFinite(p)) return price;
  const decimals = tickSize && tickSize.includes(".") ? tickSize.split(".")[1]!.replace(/0+$/, "").length : 0;
  const n = Math.round((p / tick) * 1e6) / 1e6; // whole ticks, free of float noise
  const k = side === "buy" ? Math.floor(n + 1e-9) : Math.ceil(n - 1e-9);
  return (k * tick).toFixed(decimals);
}

export interface VenuePosition {
  productId: number;
  symbol: string | null;
  size: number;
  entryPrice: string | null;
  realizedPnl: string | null;
  margin: string | null;
}

export interface VenueBalance {
  asset: string;
  balance: string;
  availableBalance: string;
}

export type PlaceOrderResult =
  | { ok: true; order: VenueOrder }
  | { ok: false; code: string; message: string; retryable: boolean }
  /** The request may or may not have reached the venue (timeout / network): reconcile before retrying. */
  | { ok: false; code: "unknown"; message: string; retryable: false; unknown: true };

export interface DeltaTradingClient {
  getProduct(symbol: string): Promise<VenueProduct>;
  /** Current mark price (decimal string) or null when the venue has none. */
  getMark(symbol: string): Promise<string | null>;
  placeOrder(creds: DeltaCredentials, input: PlaceOrderInput): Promise<PlaceOrderResult>;
  getOrder(creds: DeltaCredentials, orderId: number): Promise<VenueOrder | null>;
  listOpenOrders(creds: DeltaCredentials, productIds: readonly number[]): Promise<VenueOrder[]>;
  cancelOrder(creds: DeltaCredentials, orderId: number, productId: number): Promise<boolean>;
  getPositions(creds: DeltaCredentials): Promise<VenuePosition[]>;
  getBalances(creds: DeltaCredentials): Promise<VenueBalance[]>;
  /** The account's fills, newest first, one page per call; throws DeltaApiError when the venue does not answer or answers badly. */
  listFills(creds: DeltaCredentials, opts?: ListFillsOptions): Promise<FillsPage>;
}

/** Contracts for `lots` of `lotSize` units when one contract is `contractValue` units; null unless a whole number ≥ 1. */
export function contractsFor(lots: number, lotSize: string, contractValue: string): number | null {
  const units = lots * Number(lotSize);
  const cv = Number(contractValue);
  if (!(units > 0) || !(cv > 0)) return null;
  const n = units / cv;
  const rounded = Math.round(n);
  if (rounded < 1 || Math.abs(n - rounded) > 1e-6) return null;
  return rounded;
}

const RawOrder = z.object({
  id: z.number(),
  client_order_id: z.string().nullable().optional(),
  product_id: z.number(),
  side: z.enum(["buy", "sell"]),
  size: z.number(),
  unfilled_size: z.number().optional(),
  state: z.enum(["open", "pending", "closed", "cancelled"]),
  average_fill_price: z.union([z.string(), z.number()]).nullable().optional(),
});
const RawProduct = z.object({
  id: z.number(),
  symbol: z.string(),
  contract_value: z.union([z.string(), z.number()]),
  contract_type: z.string(),
  state: z.string(),
  tick_size: z.union([z.string(), z.number()]).nullable().optional(),
});
const RawPosition = z.object({
  product_id: z.number(),
  product_symbol: z.string().nullable().optional(),
  product: z.object({ symbol: z.string() }).nullable().optional(),
  size: z.number(),
  entry_price: z.union([z.string(), z.number()]).nullable().optional(),
  realized_pnl: z.union([z.string(), z.number()]).nullable().optional(),
  margin: z.union([z.string(), z.number()]).nullable().optional(),
});
const RawBalance = z.object({
  asset_symbol: z.string(),
  balance: z.union([z.string(), z.number()]),
  available_balance: z.union([z.string(), z.number()]).optional(),
});
const Envelope = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().optional(), context: z.unknown().optional() }).optional(),
  /** Cursor paging (fills): `after` names the next page. */
  meta: z.object({ after: z.string().nullable().optional(), before: z.string().nullable().optional() }).passthrough().optional(),
});
// a fill as documented; tolerant of extra fields and of numbers arriving as strings (the first live read settles the exact shape, GAPS #89)
const RawFill = z
  .object({
    id: z.union([z.number(), z.string()]),
    size: z.union([z.number(), z.string()]),
    price: z.union([z.string(), z.number()]),
    side: z.enum(["buy", "sell"]),
    product_id: z.number(),
    product_symbol: z.string().nullable().optional(),
    order_id: z.union([z.number(), z.string()]).nullable().optional(),
    role: z.string().nullable().optional(),
    commission: z.union([z.string(), z.number()]).nullable().optional(),
    /** ISO text, or an epoch in seconds, milliseconds or microseconds. */
    created_at: z.union([z.string(), z.number()]),
  })
  .passthrough();
/** An epoch of any of the usual units to an ISO instant; ISO text passes through. */
export function fillInstant(v: string | number): string {
  if (typeof v === "string") return v;
  const ms = v > 1e14 ? v / 1000 : v > 1e11 ? v : v * 1000;
  return new Date(ms).toISOString();
}
function toFill(r: z.infer<typeof RawFill>): VenueFill {
  return { id: String(r.id), orderId: r.order_id === null || r.order_id === undefined ? null : String(r.order_id), productId: r.product_id, symbol: r.product_symbol ?? null, side: r.side, size: Number(r.size), price: String(r.price), commission: dec(r.commission) ?? "0", role: r.role ?? null, filledAt: fillInstant(r.created_at), raw: r };
}

function dec(v: string | number | null | undefined): string | null {
  return v === null || v === undefined ? null : String(v);
}
function toOrder(r: z.infer<typeof RawOrder>): VenueOrder {
  return { id: r.id, clientOrderId: r.client_order_id ?? null, productId: r.product_id, side: r.side, size: r.size, unfilledSize: r.unfilled_size ?? 0, state: r.state, averageFillPrice: dec(r.average_fill_price) };
}

/** Error codes the venue documents for order placement that do not improve on retry. */
const FINAL_ORDER_ERRORS = new Set(["insufficient_margin", "order_size_exceed_available", "immediate_liquidation", "invalid_product_id", "open_order_limit_exceeded", "invalid_api_key", "unauthorized", "ip_not_whitelisted_for_api_key"]);

export class DeltaTradingClientImpl implements DeltaTradingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: TradingFetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly productTtlMs: number;
  private readonly products = new Map<string, { product: VenueProduct; at: number }>();
  private nextSlotMs = 0;

  constructor(opts: DeltaTradingClientOptions) {
    if ((opts.nodeEnv ?? process.env["NODE_ENV"]) === "test" && !opts.fetch) {
      throw new Error("trading safety: the live Delta trading client must not be used when NODE_ENV=test");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.minIntervalMs = opts.minIntervalMs ?? 100;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.productTtlMs = opts.productTtlMs ?? 300_000;
  }

  /** Token bucket: one call per `minIntervalMs`, measured on the injectable clock. */
  private async throttle(): Promise<void> {
    const nowMs = this.now() * 1000;
    const wait = this.nextSlotMs - nowMs;
    this.nextSlotMs = Math.max(nowMs, this.nextSlotMs) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }

  private async call(creds: DeltaCredentials | null, method: "GET" | "POST" | "DELETE", path: string, query?: string, body?: unknown): Promise<{ status: number; json: z.infer<typeof Envelope> | null; text: string } | { transport: string }> {
    await this.throttle();
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const req = creds
      ? signDeltaRequest({ baseUrl: this.baseUrl, method, path, ...(query ? { query } : {}), ...(raw !== undefined ? { body: raw } : {}), apiKey: creds.apiKey, apiSecret: creds.apiSecret, timestamp: this.now() })
      : { url: `${this.baseUrl}${path}${query ? `?${query}` : ""}`, headers: { Accept: "application/json", "User-Agent": "hapiecoin-api" } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(req.url, { method, headers: req.headers, ...(raw !== undefined ? { body: raw } : {}), signal: controller.signal });
      const text = await res.text();
      let json: z.infer<typeof Envelope> | null = null;
      try {
        const parsed = Envelope.safeParse(JSON.parse(text));
        json = parsed.success ? parsed.data : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, text };
    } catch (e) {
      return { transport: e instanceof Error && e.name === "AbortError" ? "timed out" : e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async getProduct(symbol: string): Promise<VenueProduct> {
    const cached = this.products.get(symbol);
    if (cached && this.now() * 1000 - cached.at < this.productTtlMs) return cached.product;
    const res = await this.call(null, "GET", `/v2/products/${encodeURIComponent(symbol)}`);
    if ("transport" in res) throw new Error(`Delta product lookup failed for ${symbol}: ${res.transport}`);
    const parsed = res.json?.success ? RawProduct.safeParse(res.json.result) : null;
    if (!parsed?.success) throw new Error(`Delta product lookup failed for ${symbol}: HTTP ${res.status} ${res.json?.error?.code ?? ""}`.trim());
    const product: VenueProduct = { id: parsed.data.id, symbol: parsed.data.symbol, contractValue: String(parsed.data.contract_value), contractType: parsed.data.contract_type, state: parsed.data.state, ...(parsed.data.tick_size === null || parsed.data.tick_size === undefined ? {} : { tickSize: String(parsed.data.tick_size) }) };
    this.products.set(symbol, { product, at: this.now() * 1000 });
    return product;
  }

  async getMark(symbol: string): Promise<string | null> {
    const res = await this.call(null, "GET", `/v2/tickers/${encodeURIComponent(symbol)}`);
    if ("transport" in res || !res.json?.success) return null;
    const parsed = z.object({ mark_price: z.union([z.string(), z.number()]).nullable().optional() }).safeParse(res.json.result);
    return parsed.success ? dec(parsed.data.mark_price) : null;
  }

  async placeOrder(creds: DeltaCredentials, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    if (!Number.isInteger(input.size) || input.size < 1) return { ok: false, code: "invalid_size", message: "Order size must be a whole number of contracts", retryable: false };
    const limit = input.orderType === "limit" && input.limitPrice !== undefined;
    const body = { product_id: input.productId, size: input.size, side: input.side, order_type: limit ? "limit_order" : "market_order", ...(limit ? { limit_price: input.limitPrice } : {}), client_order_id: input.clientOrderId, reduce_only: input.reduceOnly === true };
    const res = await this.call(creds, "POST", "/v2/orders", undefined, body);
    if ("transport" in res) return { ok: false, code: "unknown", message: `Order may not have reached Delta (${res.transport}); reconcile before retrying`, retryable: false, unknown: true };
    if (res.json?.success) {
      const parsed = RawOrder.safeParse(res.json.result);
      if (parsed.success) return { ok: true, order: toOrder(parsed.data) };
      return { ok: false, code: "unknown", message: "Delta accepted the order but the response could not be read; reconcile before retrying", retryable: false, unknown: true };
    }
    const code = res.json?.error?.code ?? (res.status === 429 ? "rate_limited" : `http_${res.status}`);
    return { ok: false, code, message: describeOrderError(code, res.json?.error?.context), retryable: !FINAL_ORDER_ERRORS.has(code) };
  }

  async getOrder(creds: DeltaCredentials, orderId: number): Promise<VenueOrder | null> {
    const res = await this.call(creds, "GET", `/v2/orders/${orderId}`);
    if ("transport" in res || !res.json?.success) return null;
    const parsed = RawOrder.safeParse(res.json.result);
    return parsed.success ? toOrder(parsed.data) : null;
  }

  async listOpenOrders(creds: DeltaCredentials, productIds: readonly number[]): Promise<VenueOrder[]> {
    const query = `product_ids=${productIds.slice(0, 10).join(",")}&states=open,pending`;
    const res = await this.call(creds, "GET", "/v2/orders", query);
    if ("transport" in res || !res.json?.success) return [];
    const parsed = z.array(RawOrder).safeParse(res.json.result);
    return parsed.success ? parsed.data.map(toOrder) : [];
  }

  async cancelOrder(creds: DeltaCredentials, orderId: number, productId: number): Promise<boolean> {
    const res = await this.call(creds, "DELETE", "/v2/orders", undefined, { id: orderId, product_id: productId });
    return !("transport" in res) && res.json?.success === true;
  }

  /** Throws when the venue does not answer or answers badly: "no positions" and "could not read positions" must never look alike (ADR-059 §2.2 drift). */
  async getPositions(creds: DeltaCredentials): Promise<VenuePosition[]> {
    const res = await this.call(creds, "GET", "/v2/positions/margined");
    if ("transport" in res) throw new DeltaApiError("/v2/positions/margined", "positions_unavailable", { transport: true });
    if (!res.json?.success) throw new DeltaApiError("/v2/positions/margined", "positions_unavailable", { status: res.status });
    const parsed = z.array(RawPosition).safeParse(res.json.result);
    if (!parsed.success) throw new DeltaApiError("/v2/positions/margined", "positions_unavailable", { parse: true });
    return parsed.data.map((p) => ({ productId: p.product_id, symbol: p.product_symbol ?? p.product?.symbol ?? null, size: p.size, entryPrice: dec(p.entry_price), realizedPnl: dec(p.realized_pnl), margin: dec(p.margin) }));
  }

  async getBalances(creds: DeltaCredentials): Promise<VenueBalance[]> {
    const res = await this.call(creds, "GET", "/v2/wallet/balances");
    if ("transport" in res || !res.json?.success) return [];
    const parsed = z.array(RawBalance).safeParse(res.json.result);
    if (!parsed.success) return [];
    return parsed.data.map((b) => ({ asset: b.asset_symbol, balance: String(b.balance), availableBalance: String(b.available_balance ?? b.balance) }));
  }

  /** Read-only. Like positions, an unreadable page throws: "no fills" and "could not read fills" must never look alike. */
  async listFills(creds: DeltaCredentials, opts: ListFillsOptions = {}): Promise<FillsPage> {
    const size = Math.min(100, Math.max(1, opts.pageSize ?? 100));
    const query = `page_size=${size}${opts.after ? `&after=${encodeURIComponent(opts.after)}` : ""}`;
    const res = await this.call(creds, "GET", "/v2/fills", query);
    if ("transport" in res) throw new DeltaApiError("/v2/fills", "fills_unavailable", { transport: true });
    if (!res.json?.success) throw new DeltaApiError("/v2/fills", "fills_unavailable", { status: res.status, code: res.json?.error?.code });
    const parsed = z.array(RawFill).safeParse(res.json.result);
    if (!parsed.success) throw new DeltaApiError("/v2/fills", "fills_unavailable", { parse: true, keys: Array.isArray(res.json.result) && res.json.result[0] && typeof res.json.result[0] === "object" ? Object.keys(res.json.result[0] as object) : [] });
    return { fills: parsed.data.map(toFill), after: res.json.meta?.after ?? null };
  }
}

export function describeOrderError(code: string, context?: unknown): string {
  const extra = typeof context === "object" && context !== null && "additional_margin_required" in context ? ` (additional margin required: ${String((context as Record<string, unknown>)["additional_margin_required"])})` : "";
  switch (code) {
    case "insufficient_margin":
      return `Not enough margin on the exchange for this order${extra}`;
    case "order_size_exceed_available":
      return "Order size exceeds what the exchange allows for this product";
    case "immediate_liquidation":
      return "The exchange refused the order because it would liquidate the position immediately";
    case "invalid_product_id":
      return "The exchange does not know this product";
    case "market_disrupted":
      return "The market for this product is disrupted; try again shortly";
    case "open_order_limit_exceeded":
      return "Too many open orders on the exchange for this product";
    case "rate_limited":
      return "The exchange rate limit was hit; try again shortly";
    default:
      return `Delta Exchange rejected the order (${code})`;
  }
}

/** Test double (trading-safety rule 2): fills or fails by product / client order id and records every call. */
export class FakeDeltaTradingClient implements DeltaTradingClient {
  readonly placed: { creds: DeltaCredentials; input: PlaceOrderInput }[] = [];
  readonly cancelled: number[] = [];
  private readonly productsBySymbol = new Map<string, VenueProduct>();
  private readonly marks = new Map<string, string>();
  private readonly fillPrices = new Map<number, string>();
  private readonly failures = new Map<number, { code: string; retryable?: boolean; once?: boolean }>();
  private readonly orders = new Map<number, VenueOrder>();
  private positions: VenuePosition[] = [];
  private balances: VenueBalance[] = [{ asset: "USD", balance: "10000", availableBalance: "10000" }];
  private nextId = 1000;
  private partialNext = false;

  product(symbol: string, id: number, contractValue = "0.001", state = "live", tickSize = "0.1"): this {
    this.productsBySymbol.set(symbol, { id, symbol, contractValue, contractType: symbol.endsWith("USD") ? "perpetual_futures" : symbol.startsWith("C-") ? "call_options" : "put_options", state, tickSize });
    return this;
  }
  markAt(symbol: string, price: string): this {
    this.marks.set(symbol, price);
    return this;
  }
  getMark(symbol: string): Promise<string | null> {
    return Promise.resolve(this.marks.get(symbol) ?? null);
  }
  fillAt(productId: number, price: string): this {
    this.fillPrices.set(productId, price);
    return this;
  }
  failWith(productId: number, code: string, opts: { retryable?: boolean; once?: boolean } = {}): this {
    this.failures.set(productId, { code, ...opts });
    return this;
  }
  /** Forget a scripted failure (tests reset between cases). */
  succeed(productId: number): this {
    this.failures.delete(productId);
    return this;
  }
  /** The next placement fills only partially (state open, unfilled 1). */
  partialNextOrder(): this {
    this.partialNext = true;
    return this;
  }
  setBalances(balances: VenueBalance[]): this {
    this.balances = balances;
    return this;
  }
  setPositions(positions: VenuePosition[]): this {
    this.positions = positions;
    return this;
  }
  /** Delist a product so lookups fail (tests drive the exchange-error path on exits). */
  forget(symbol: string): this {
    this.productsBySymbol.delete(symbol);
    return this;
  }
  /** Complete a previously partial order (tests drive the sync path). */
  complete(orderId: number, price: string): void {
    const o = this.orders.get(orderId);
    if (o) this.orders.set(orderId, { ...o, state: "closed", unfilledSize: 0, averageFillPrice: price });
  }

  getProduct(symbol: string): Promise<VenueProduct> {
    const p = this.productsBySymbol.get(symbol);
    return p ? Promise.resolve(p) : Promise.reject(new Error(`Delta product lookup failed for ${symbol}: not listed`));
  }
  placeOrder(creds: DeltaCredentials, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    this.placed.push({ creds, input });
    const failure = this.failures.get(input.productId);
    if (failure) {
      if (failure.once) this.failures.delete(input.productId);
      if (failure.code === "unknown") return Promise.resolve({ ok: false, code: "unknown", message: "timed out", retryable: false, unknown: true });
      return Promise.resolve({ ok: false, code: failure.code, message: describeOrderError(failure.code), retryable: failure.retryable ?? false });
    }
    const id = this.nextId++;
    const price = this.fillPrices.get(input.productId) ?? "100";
    // a limit fills only when it crosses the fake's fill price (buy at or above it, sell at or below it); otherwise it rests open
    const limit = input.orderType === "limit" && input.limitPrice !== undefined ? Number(input.limitPrice) : null;
    const crosses = limit === null || (input.side === "buy" ? limit >= Number(price) : limit <= Number(price));
    if (!crosses) {
      const resting: VenueOrder = { id, clientOrderId: input.clientOrderId, productId: input.productId, side: input.side, size: input.size, unfilledSize: input.size, state: "open", averageFillPrice: null };
      this.orders.set(id, resting);
      return Promise.resolve({ ok: true, order: resting });
    }
    const partial = this.partialNext;
    this.partialNext = false;
    const order: VenueOrder = { id, clientOrderId: input.clientOrderId, productId: input.productId, side: input.side, size: input.size, unfilledSize: partial ? 1 : 0, state: partial ? "open" : "closed", averageFillPrice: partial ? null : price };
    this.orders.set(id, order);
    return Promise.resolve({ ok: true, order });
  }
  getOrder(_creds: DeltaCredentials, orderId: number): Promise<VenueOrder | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }
  listOpenOrders(_creds: DeltaCredentials, productIds: readonly number[]): Promise<VenueOrder[]> {
    return Promise.resolve([...this.orders.values()].filter((o) => productIds.includes(o.productId) && (o.state === "open" || o.state === "pending")));
  }
  cancelOrder(_creds: DeltaCredentials, orderId: number, productId?: number): Promise<boolean> {
    const o = this.orders.get(orderId);
    if (!o || (productId !== undefined && o.productId !== productId)) return Promise.resolve(false); // the venue keys cancels by product
    this.orders.set(orderId, { ...o, state: "cancelled" });
    this.cancelled.push(orderId);
    return Promise.resolve(true);
  }
  /** Test knob: the venue does not answer the positions read. */
  positionsDown = false;
  getPositions(): Promise<VenuePosition[]> {
    return this.positionsDown ? Promise.reject(new DeltaApiError("/v2/positions/margined", "positions_unavailable", { fake: true })) : Promise.resolve(this.positions);
  }
  getBalances(): Promise<VenueBalance[]> {
    return Promise.resolve(this.balances);
  }
  /** Fills the fake venue reports, newest first, keyed by the key that reads them (a sub-account sees only its own). */
  private readonly fillsByKey = new Map<string, VenueFill[]>();
  /** Test knob: the venue does not answer the fills read. */
  fillsDown = false;
  /** Record a fill for the account behind `apiKey`; defaults make a filled BTC option trade. */
  addFill(apiKey: string, fill: Partial<VenueFill> & { productId: number; side: OrderSide; size: number; price: string }): VenueFill {
    const list = this.fillsByKey.get(apiKey) ?? [];
    const id = fill.id ?? `fill_${apiKey}_${list.length + 1}`;
    const filledAt = fill.filledAt ?? new Date(Date.UTC(2026, 8, 12, 9, list.length)).toISOString();
    const symbol = fill.symbol ?? [...this.productsBySymbol.values()].find((p) => p.id === fill.productId)?.symbol ?? null;
    // the fake's "venue row" is spelt like the documented one, so the stored raw rows look like a real read
    const raw = fill.raw ?? { id, size: fill.size, price: fill.price, side: fill.side, product_id: fill.productId, product_symbol: symbol, commission: fill.commission ?? "0", role: fill.role ?? "taker", created_at: filledAt };
    const full: VenueFill = { id, orderId: fill.orderId ?? null, symbol, commission: fill.commission ?? "0", role: fill.role ?? "taker", filledAt, productId: fill.productId, side: fill.side, size: fill.size, price: fill.price, raw };
    list.push(full);
    this.fillsByKey.set(apiKey, list);
    return full;
  }
  listFills(creds: DeltaCredentials, opts: ListFillsOptions = {}): Promise<FillsPage> {
    if (this.fillsDown) return Promise.reject(new DeltaApiError("/v2/fills", "fills_unavailable", { transport: true, fake: true }));
    const all = [...(this.fillsByKey.get(creds.apiKey) ?? [])].sort((a, b) => b.filledAt.localeCompare(a.filledAt));
    const size = Math.min(100, Math.max(1, opts.pageSize ?? 100));
    const start = opts.after ? Number(opts.after) : 0;
    const page = all.slice(start, start + size);
    return Promise.resolve({ fills: page, after: start + size < all.length ? String(start + size) : null });
  }
}

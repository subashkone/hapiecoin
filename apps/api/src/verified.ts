// Verified P&L (ADR-073; HC-TR-179..181). The fills of every connected key are read from the venue, newest first,
// page by page, and kept in `venue_fills`; realised P&L is then computed from those fills alone (average cost per
// product, commissions off), which is what makes the figure "verified": it holds trades made on the exchange's own
// app too, and it does not depend on HapieCoin's own bookkeeping. Read-only against the venue: `listFills`,
// `getProduct` and `getPositions` are the only calls. A leader-only job re-reads every account every FILLS_INGEST_MS;
// the Journal's Refresh button reads the caller's accounts on demand. Never runs under NODE_ENV=test unless a test
// calls it.
import { type VerifiedAccount, type VerifiedPnl, dayBack, sumSince, toDecimal, verifiedFromFills } from "@hapiecoin/schema";
import { DeltaApiError, type VenueFill } from "@hapiecoin/venues";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { brokerCredentials, brokers, fillWatermarks, strategies, venueFills } from "./db/schema.js";
import { openCredential } from "./routes/live-exec.js";
import { type AppDeps, errorMessage, newId } from "./routes/shared.js";

export interface IngestOptions {
  /** Only this user's accounts (the Refresh button); every account otherwise (the job). */
  userId?: string | undefined;
  /** Pages of 100 per account per pass, for a first read and for the backfill; a later pass reads newer fills until it meets one it holds. */
  maxPages?: number | undefined;
  /** Skip an account read more recently than this (the button, so a held-down click does not hammer the venue). */
  minGapMs?: number | undefined;
  now?: (() => number) | undefined;
}

export interface IngestResult {
  accounts: number;
  read: number;
  added: number;
  skipped: number;
  errors: string[];
}

/** A hard bound on the newest-first walk of a later pass: past it the cursor is kept and the rest comes next pass. */
const NEWER_PAGES_CAP = 50;

/** The sentence the Journal shows for a failed read; never the venue's code alone. */
export function describeFillsError(e: unknown): string {
  if (e instanceof DeltaApiError) {
    const ctx = typeof e.context === "object" && e.context !== null ? (e.context as Record<string, unknown>) : {};
    if (ctx["transport"]) return "The exchange did not answer the fills read";
    if (ctx["parse"]) return "The exchange answered the fills read in a shape HapieCoin could not read";
    if (ctx["status"] === 429 || ctx["code"] === "rate_limited") return "The exchange rate limit was hit reading fills; the next read will retry";
    return "The exchange refused the fills read";
  }
  return errorMessage(e);
}

/** One pass over the accounts; a failure is recorded on the account's watermark and never thrown. */
export async function ingestFills(deps: AppDeps, opts: IngestOptions = {}): Promise<IngestResult> {
  const now = opts.now ?? Date.now;
  const maxPages = opts.maxPages ?? 3;
  const rows = await deps.db
    .select({ key: brokerCredentials, venue: brokers.venue })
    .from(brokerCredentials)
    .innerJoin(brokers, eq(brokerCredentials.brokerId, brokers.id))
    .where(opts.userId ? eq(brokerCredentials.userId, opts.userId) : undefined)
    .orderBy(asc(brokerCredentials.connectedAt));
  const out: IngestResult = { accounts: rows.length, read: 0, added: 0, skipped: 0, errors: [] };
  for (const { key, venue } of rows) {
    const at = new Date(now());
    const [prev] = await deps.db.select().from(fillWatermarks).where(eq(fillWatermarks.accountId, key.id)).limit(1);
    if (opts.minGapMs !== undefined && prev && at.getTime() - prev.lastReadAt.getTime() < opts.minGapMs) {
      out.skipped += 1;
      continue;
    }
    try {
      const user = { id: key.userId, email: "", name: "", role: "user" as const };
      const creds = await openCredential(deps, user, key.brokerId, undefined, key.id);
      const client = deps.tradingFor(venue);
      const known = new Set((await deps.db.select({ id: venueFills.venueFillId }).from(venueFills).where(eq(venueFills.accountId, key.id))).map((r) => r.id));
      const first = known.size === 0 && !prev?.resumeAfter;
      // contract values once per symbol per pass, while the product is live on the venue (an expired one may not be served later)
      const cvCache = new Map<string, string | null>();
      const contractValueOf = async (symbol: string | null): Promise<string | null> => {
        if (!symbol) return null;
        if (!cvCache.has(symbol)) cvCache.set(symbol, await client.getProduct(symbol).then((p) => p.contractValue).catch(() => null));
        return cvCache.get(symbol) ?? null;
      };
      let newest = prev?.lastFillAt ?? null;
      const store = async (fills: readonly VenueFill[]): Promise<{ seen: boolean; added: number }> => {
        let seen = false;
        const values = [];
        for (const f of fills) {
          if (known.has(f.id)) {
            seen = true;
            continue;
          }
          const filledAt = new Date(f.filledAt);
          if (Number.isNaN(filledAt.getTime())) continue;
          values.push({ id: newId("fill"), userId: key.userId, accountId: key.id, venueFillId: f.id, orderId: f.orderId, productId: f.productId, symbol: f.symbol, side: f.side, size: f.size, price: f.price, commission: f.commission, role: f.role, contractValue: await contractValueOf(f.symbol), filledAt, raw: f.raw, createdAt: at });
          known.add(f.id);
          if (newest === null || filledAt > newest) newest = filledAt;
        }
        if (values.length) await deps.db.insert(venueFills).values(values).onConflictDoNothing();
        return { seen, added: values.length };
      };
      // 1. newest first: a first read takes maxPages pages and remembers where it stopped; a later pass reads until it
      //    meets a fill it holds (bounded, and the cursor kept when the bound is hit, so nothing is ever skipped)
      let resumeAfter: string | null = prev?.resumeAfter ?? null;
      let cappedThisPass = false;
      let after: string | null = null;
      for (let pages = 0; ; ) {
        const page = await client.listFills(creds, { after, pageSize: 100 });
        pages += 1;
        out.read += page.fills.length;
        const r = await store(page.fills);
        out.added += r.added;
        if (r.seen || page.after === null) break;
        if ((first && pages >= maxPages) || pages >= NEWER_PAGES_CAP) {
          resumeAfter = page.after; // the older pages come next pass
          cappedThisPass = true;
          break;
        }
        after = page.after;
      }
      // 2. backfill: continue an earlier walk that stopped on its cap, maxPages pages at a time, until the venue's history ends
      if (resumeAfter !== null && !cappedThisPass) {
        let cursor: string | null = resumeAfter;
        for (let pages = 0; cursor !== null && pages < maxPages; pages += 1) {
          const page = await client.listFills(creds, { after: cursor, pageSize: 100 });
          out.read += page.fills.length;
          out.added += (await store(page.fills)).added;
          cursor = page.after;
        }
        resumeAfter = cursor;
      }
      // 3. the venue's net position per product against what the fills held add up to: a product opened before the
      //    fills read (or beyond the venue's history) cannot be verified and is named as partial, never guessed
      const held = await deps.db.select({ productId: venueFills.productId, side: venueFills.side, size: venueFills.size }).from(venueFills).where(eq(venueFills.accountId, key.id));
      const net = new Map<number, number>();
      for (const h of held) net.set(h.productId, (net.get(h.productId) ?? 0) + (h.side === "buy" ? h.size : -h.size));
      const positions = await client.getPositions(creds);
      const partial = new Set<number>();
      for (const p of positions) if (p.size !== (net.get(p.productId) ?? 0)) partial.add(p.productId);
      for (const [productId, size] of net) if (size !== 0 && !positions.some((p) => p.productId === productId)) partial.add(productId);
      await deps.db
        .insert(fillWatermarks)
        .values({ accountId: key.id, userId: key.userId, lastReadAt: at, lastFillAt: newest, fills: known.size, resumeAfter, partialProducts: [...partial], error: null, updatedAt: at })
        .onConflictDoUpdate({ target: fillWatermarks.accountId, set: { lastReadAt: at, lastFillAt: newest, fills: known.size, resumeAfter, partialProducts: [...partial], error: null, updatedAt: at } });
    } catch (e) {
      const message = describeFillsError(e);
      out.errors.push(`${key.label}: ${message}`);
      deps.logger.warn({ accountId: key.id, err: errorMessage(e) }, "fills: account skipped");
      await deps.db
        .insert(fillWatermarks)
        .values({ accountId: key.id, userId: key.userId, lastReadAt: at, lastFillAt: null, fills: 0, resumeAfter: null, partialProducts: [], error: message, updatedAt: at })
        .onConflictDoUpdate({ target: fillWatermarks.accountId, set: { error: message, updatedAt: at } });
    }
  }
  if (out.accounts) deps.logger.info(out, "fills: accounts read");
  return out;
}

/** Start the periodic pass; returns the stop function. Overlapping passes are skipped. */
export function startFillsIngest(deps: AppDeps, intervalMs = 300_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await ingestFills(deps);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The verified figures for one trader: per account and in total, with the Journal's own figure beside them. */
export async function computeVerified(deps: AppDeps, userId: string, nowMs = Date.now()): Promise<VerifiedPnl> {
  const keys = await deps.db
    .select({ key: brokerCredentials, venue: brokers.venue })
    .from(brokerCredentials)
    .innerJoin(brokers, eq(brokerCredentials.brokerId, brokers.id))
    .where(eq(brokerCredentials.userId, userId))
    .orderBy(asc(brokerCredentials.connectedAt));
  const marks = keys.length ? await deps.db.select().from(fillWatermarks).where(inArray(fillWatermarks.accountId, keys.map((k) => k.key.id))) : [];
  const accounts: VerifiedAccount[] = [];
  const allDays = new Map<string, number>();
  let fillsTotal = 0;
  let realizedTotal = 0;
  let commissionTotal = 0;
  let since: Date | null = null;
  let lastReadAt: Date | null = null;
  for (const { key } of keys) {
    const fills = await deps.db.select().from(venueFills).where(eq(venueFills.accountId, key.id)).orderBy(asc(venueFills.filledAt));
    const wm = marks.find((m) => m.accountId === key.id);
    // the contract value stored at ingest; a row without one (the product was already gone) is skipped and counted
    const totals = verifiedFromFills(
      fills.map((f) => ({ productId: f.productId, symbol: f.symbol, side: f.side, size: f.size, price: f.price, commission: f.commission, filledAt: f.filledAt.toISOString(), contractValue: f.contractValue })),
      (_productId, _symbol, stored) => stored ?? null,
    );
    for (const d of totals.byDay) allDays.set(d.day, (allDays.get(d.day) ?? 0) + Number(d.pnl));
    fillsTotal += fills.length;
    realizedTotal += totals.realizedUsd;
    commissionTotal += totals.commissionUsd;
    const oldest = fills[0]?.filledAt ?? null;
    if (oldest && (since === null || oldest < since)) since = oldest;
    if (wm?.lastReadAt && (lastReadAt === null || wm.lastReadAt > lastReadAt)) lastReadAt = wm.lastReadAt;
    accounts.push({
      accountId: key.id,
      label: key.label,
      fills: fills.length,
      lastReadAt: wm?.lastReadAt?.toISOString() ?? null,
      lastFillAt: wm?.lastFillAt?.toISOString() ?? null,
      since: oldest?.toISOString() ?? null,
      realizedUsd: toDecimal(totals.realizedUsd, 2),
      commissionUsd: toDecimal(totals.commissionUsd, 2),
      byDay: totals.byDay,
      skipped: totals.skipped,
      partialProducts: wm?.partialProducts?.length ?? 0,
      backfilling: wm?.resumeAfter !== null && wm?.resumeAfter !== undefined,
      error: wm?.error ?? null,
    });
  }
  const byDay = [...allDays.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, pnl]) => ({ day, pnl: toDecimal(pnl, 2) }));
  // the Journal books live strategies gross (no fees) and at expiry through the settler: the comparison is gross to gross
  const journalRows = await deps.db
    .select({ realizedPnl: strategies.realizedPnl })
    .from(strategies)
    .where(and(eq(strategies.userId, userId), eq(strategies.status, "archived"), eq(strategies.tradingMode, "live"), since ? gte(strategies.closedAt, since) : undefined));
  const journal = journalRows.reduce((s, r) => s + Number(r.realizedPnl), 0);
  const gross = realizedTotal + commissionTotal;
  return {
    accounts,
    total: { all: toDecimal(realizedTotal, 2), gross: toDecimal(gross, 2), d7: toDecimal(sumSince(byDay, dayBack(nowMs, 7)), 2), d30: toDecimal(sumSince(byDay, dayBack(nowMs, 30)), 2), commission: toDecimal(commissionTotal, 2) },
    fills: fillsTotal,
    lastReadAt: lastReadAt?.toISOString() ?? null,
    since: since?.toISOString() ?? null,
    journalRealizedUsd: toDecimal(journal, 2),
    difference: toDecimal(gross - journal, 2),
  };
}

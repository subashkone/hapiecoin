/**
 * Whale tracking state and the pure maths behind the `whales` dataset (HC-MA-067..071; ADR-043): position diffs
 * between polls become alerts, order-book levels above a threshold become "large orders" with first/last-seen
 * tracking, and the hourly alert notional feeds the Whale Index.
 */
import type { LargeOrder, WhaleAlert, WhalePosition } from "@hapiecoin/schema";
import type { OrderBook } from "./adapters/bybit.js";

const key = (p: WhalePosition): string => `${p.wallet}:${p.coin}`;

/**
 * Alerts for the wallets in `polled`: a position that appeared, vanished, grew, shrank or flipped side by at least
 * `minUsd` of notional. Wallets outside `polled` are not compared (their previous state is simply carried).
 */
export function diffPositions(prev: ReadonlyMap<string, readonly WhalePosition[]>, next: ReadonlyMap<string, readonly WhalePosition[]>, polled: ReadonlySet<string>, now: number, minUsd: number): WhaleAlert[] {
  const out: WhaleAlert[] = [];
  for (const wallet of polled) {
    const before = new Map((prev.get(wallet) ?? []).map((p) => [key(p), p]));
    const after = new Map((next.get(wallet) ?? []).map((p) => [key(p), p]));
    for (const [k, n] of after) {
      const p = before.get(k);
      if (!p) {
        if (n.notionalUsd >= minUsd) out.push({ t: now, wallet, coin: n.coin, side: n.side, action: "opened", changeUsd: n.notionalUsd, positionUsd: n.notionalUsd, entryPx: n.entryPx, leverage: n.leverage });
        continue;
      }
      if (p.side !== n.side) {
        const change = p.notionalUsd + n.notionalUsd;
        if (change >= minUsd) out.push({ t: now, wallet, coin: n.coin, side: n.side, action: "flipped", changeUsd: change, positionUsd: n.notionalUsd, entryPx: n.entryPx, leverage: n.leverage });
        continue;
      }
      const delta = n.notionalUsd - p.notionalUsd;
      if (Math.abs(delta) >= minUsd) out.push({ t: now, wallet, coin: n.coin, side: n.side, action: delta > 0 ? "increased" : "reduced", changeUsd: Math.abs(delta), positionUsd: n.notionalUsd, entryPx: n.entryPx, leverage: n.leverage });
    }
    for (const [k, p] of before) {
      if (after.has(k) || p.notionalUsd < minUsd) continue;
      out.push({ t: now, wallet, coin: p.coin, side: p.side, action: "closed", changeUsd: p.notionalUsd, positionUsd: 0, entryPx: p.entryPx, leverage: p.leverage });
    }
  }
  return out.sort((a, b) => b.changeUsd - a.changeUsd);
}

/** Book levels worth at least `minUsd`, as fresh large orders. */
export function wallsFrom(book: OrderBook, symbol: string, venue: LargeOrder["venue"], now: number, minUsd: number): LargeOrder[] {
  const out: LargeOrder[] = [];
  const add = (side: "bid" | "ask", levels: OrderBook["asks"]) => {
    for (const l of levels) {
      const usd = l.price * l.qty;
      if (usd >= minUsd) out.push({ venue, symbol, side, price: l.price, qty: l.qty, usd, firstSeen: now, lastSeen: now, resting: true });
    }
  };
  add("bid", book.bids);
  add("ask", book.asks);
  return out;
}

/** Carry first-seen stamps across polls; a level that left the book stays listed as not resting for `keepGoneMs`. */
export function mergeWalls(prev: readonly LargeOrder[], fresh: readonly LargeOrder[], scope: ReadonlySet<string>, now: number, keepGoneMs = 30 * 60_000): LargeOrder[] {
  const id = (o: LargeOrder) => `${o.venue}:${o.symbol}:${o.side}:${o.price}`;
  const current = new Map(fresh.map((o) => [id(o), o]));
  const out: LargeOrder[] = [];
  for (const p of prev) {
    const f = current.get(id(p));
    if (f) {
      out.push({ ...f, firstSeen: p.firstSeen });
      current.delete(id(p));
      continue;
    }
    if (!scope.has(p.symbol)) {
      out.push(p); // not polled this round: unchanged
      continue;
    }
    if (now - p.lastSeen <= keepGoneMs) out.push({ ...p, resting: false }); // last seen stays the poll that saw it
  }
  out.push(...current.values());
  return out.sort((a, b) => b.usd - a.usd);
}

/** Add `usd` into the current hour of a kept series and return the bucket. */
export const hourOf = (now: number): number => Math.floor(now / 3_600_000) * 3_600_000;

/** Mutable state the whale job carries between runs. */
export class WhaleTracker {
  candidates: string[] = [];
  candidatesAt = 0;
  candidateSource = "none";
  /** Last known positions per wallet (only wallets that were polled at least once). */
  readonly positions = new Map<string, WhalePosition[]>();
  alerts: WhaleAlert[] = [];
  walls: LargeOrder[] = [];
  /** Alert notional accumulated in the current hour (restarts at zero on boot). */
  hour = { t: 0, v: 0 };
  runs = 0;

  constructor(readonly opts: { alertMinUsd: number; wallMinUsd: number; maxAlerts?: number; maxPositions?: number } = { alertMinUsd: 1_000_000, wallMinUsd: 1_000_000 }) {}

  /** Wallets to poll this run: every candidate on a full scan, else the ones holding positions plus `always`. */
  pollSet(fullScan: boolean, always: readonly string[]): string[] {
    const set = new Set<string>(always);
    if (fullScan) for (const c of this.candidates) set.add(c);
    else for (const [w, ps] of this.positions) if (ps.length > 0) set.add(w);
    return [...set];
  }

  /** Apply one round of polled positions: returns the alerts it produced. */
  apply(next: ReadonlyMap<string, WhalePosition[]>, polled: ReadonlySet<string>, now: number): WhaleAlert[] {
    const alerts = diffPositions(this.positions, next, polled, now, this.opts.alertMinUsd);
    for (const w of polled) this.positions.set(w, [...(next.get(w) ?? [])]);
    this.alerts = [...alerts, ...this.alerts].slice(0, this.opts.maxAlerts ?? 100);
    const hour = hourOf(now);
    if (this.hour.t !== hour) this.hour = { t: hour, v: 0 };
    this.hour.v += alerts.reduce((s, a) => s + a.changeUsd, 0);
    return alerts;
  }

  /** Every open position across tracked wallets, largest first, capped. */
  openPositions(marks: ReadonlyMap<string, number>): WhalePosition[] {
    const all: WhalePosition[] = [];
    for (const ps of this.positions.values()) for (const p of ps) all.push({ ...p, markPx: marks.get(p.coin) ?? p.markPx });
    return all.sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, this.opts.maxPositions ?? 100);
  }

  walletsWithPositions(): number {
    let n = 0;
    for (const ps of this.positions.values()) if (ps.length > 0) n += 1;
    return n;
  }
}

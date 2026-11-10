// Playbook records (ADR-101; HC-TR-205, HC-TR-206): the job computes one record per playbook and asset over the recorded
// days, upserts it, leaves it alone until a newer day lands, and the route serves the venue's records behind the session.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAYBOOKS } from "@hapiecoin/pricing";
import type { Instrument, PlaybookRecords, Quote } from "@hapiecoin/schema";
import { count, eq } from "drizzle-orm";
import { clearEodMemo } from "./chain-eod.js";
import { chainEod, playbookRecords } from "./db/schema.js";
import { snapshotOnce, type MarketSource } from "./iv-snapshot.js";
import { PLAYBOOK_ASSETS, refreshPlaybookRecords } from "./playbooks.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("playbooks@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** Ten strikes on two expiries (a week and a month out) with marks following moneyness; the spot drifts up 400 a day. */
function sourceOn(dayIndex: number): MarketSource {
  const spot = 80_000 + dayIndex * 400;
  const expiries = ["2026-09-08", "2026-10-02"];
  const strikes = [76_000, 77_000, 78_000, 79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000];
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of expiries)
    for (const k of strikes) {
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      const ts = T0 + dayIndex * DAY;
      quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: String(Math.max(spot - k, 0) + 400), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts, mark: String(Math.max(k - spot, 0) + 400), oi: "1", spot: String(spot), markIv: 0.42 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const rows = async () => t.db.select({ playbookId: playbookRecords.playbookId, asset: playbookRecords.asset, lastDay: playbookRecords.lastDay, status: playbookRecords.status, computedAt: playbookRecords.computedAt }).from(playbookRecords);

describe("HC-TR-205 the playbook records job", () => {
  it("HC-TR-205 is 503 on the route before any record, computes one record per playbook for the recorded asset, upserts, and leaves records alone until the recorded history changes", async () => {
    expect((await t.request("/v1/playbooks")).status).toBe(401);
    expect((await t.request("/v1/playbooks", { cookie })).status).toBe(503);
    clearEodMemo();
    for (let d = 0; d <= 6; d++) await snapshotOnce(t.deps, sourceOn(d), () => T0 + d * DAY + HOUR);
    const first = await refreshPlaybookRecords({ db: t.db, logger: t.deps.logger, now: () => T0 + 7 * DAY }, ["delta_india"]);
    // BTC has seven recorded days; ETH none
    expect(first).toEqual({ computed: PLAYBOOKS.filter((p) => p.assets.includes("BTC")).length, skipped: 0, noData: PLAYBOOK_ASSETS.length - 1, failed: 0 });
    const stored = await rows();
    expect(stored).toHaveLength(first.computed);
    expect(new Set(stored.map((r) => r.asset))).toEqual(new Set(["BTC"]));
    for (const r of stored) expect(r.lastDay).toBe("2026-09-07");
    // seven days cannot give twenty closed trades: every record is insufficient, the control included
    expect(stored.every((r) => r.status === "insufficient")).toBe(true);

    // nothing newer recorded: the second run skips everything
    const again = await refreshPlaybookRecords({ db: t.db, logger: t.deps.logger, now: () => T0 + 7 * DAY + HOUR }, ["delta_india"]);
    expect(again).toEqual({ computed: 0, skipped: first.computed, noData: PLAYBOOK_ASSETS.length - 1, failed: 0 });
    expect((await rows())[0]!.computedAt.getTime()).toBe(T0 + 7 * DAY);

    // an OLDER day added behind the same last day (the candle backfill, ADR-098) changes the stamp: everything recomputes
    clearEodMemo();
    await t.db.insert(chainEod).values({ venue: "delta_india", asset: "BTC", day: "2026-08-31", expiry: "2026-09-08", strike: "80000", kind: "call", mark: "400", markIv: null, spot: "79600", ts: new Date(T0 - DAY), source: "candles" });
    const older = await refreshPlaybookRecords({ db: t.db, logger: t.deps.logger, now: () => T0 + 7 * DAY + 2 * HOUR }, ["delta_india"]);
    expect(older.computed).toBe(first.computed);
    expect((await rows()).every((r) => r.lastDay === "2026-09-07")).toBe(true);

    // a newer day: every record is recomputed in place (no duplicate rows)
    clearEodMemo();
    await snapshotOnce(t.deps, sourceOn(7), () => T0 + 7 * DAY + HOUR);
    const third = await refreshPlaybookRecords({ db: t.db, logger: t.deps.logger, now: () => T0 + 8 * DAY }, ["delta_india"]);
    expect(third.computed).toBe(first.computed);
    expect((await t.db.select({ n: count() }).from(playbookRecords))[0]!.n).toBe(first.computed);
    expect((await rows()).every((r) => r.lastDay === "2026-09-08")).toBe(true);
  });

  it("HC-TR-206 GET /v1/playbooks lists the venue's records with their status and the record's halves and losing years", async () => {
    const res = await t.request("/v1/playbooks", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const body = await json<PlaybookRecords>(res);
    expect(body.venue).toBe("delta_india");
    expect(body.records.map((r) => r.playbookId).sort()).toEqual(PLAYBOOKS.filter((p) => p.assets.includes("BTC")).map((p) => p.id).sort());
    const hero = body.records.find((r) => r.playbookId === "hero-or-zero")!;
    expect(hero.asset).toBe("BTC");
    expect(hero.record.folds).toHaveLength(2);
    expect(hero.record.trials).toBe(1);
    expect(hero.record.status).toBe("insufficient");
    expect(hero.record.days).toBe(9); // seven live days, one re-recorded, one older candle day
    expect(hero.record.fees).toBe("venue");
    expect(Array.isArray(hero.record.losingYears)).toBe(true);
    // deribit has no record: 503
    expect((await t.request("/v1/playbooks?venue=deribit", { cookie })).status).toBe(503);
    expect(await t.db.select({ status: playbookRecords.status }).from(playbookRecords).where(eq(playbookRecords.playbookId, "hero-or-zero"))).toHaveLength(1);
  });
});

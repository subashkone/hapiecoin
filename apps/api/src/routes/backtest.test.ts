// Backtest route (ADR-077; HC-TR-184): behind the session, 503 until a day is recorded, 400 for an unknown template or
// a reversed range, then the projection of the engine's result over the recorded end-of-day chains.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BacktestResult, Instrument, Quote } from "@hapiecoin/schema";
import { clearEodMemo } from "../chain-eod.js";
import { snapshotOnce, type MarketSource } from "../iv-snapshot.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("backtest@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // 1 Sep 2026 at the settlement hour
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: symbol.length + strike, isActive: true };
}
/** Five strikes on an expiry five days out and one a month out; marks follow moneyness and a rising spot. */
function sourceOn(dayIndex: number): MarketSource {
  const spot = 80_000 + dayIndex * 600;
  const expiries = ["2026-09-06", "2026-10-02"];
  const strikes = [78_000, 79_000, 80_000, 81_000, 82_000];
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

describe("HC-TR-184 GET /v1/backtest", () => {
  it("needs a session, refuses an unknown template, and is 503 until a day is recorded", async () => {
    expect((await t.request("/v1/backtest?asset=BTC&template=Buy%20Call")).status).toBe(401);
    expect((await t.request("/v1/backtest?asset=BTC&template=Nope", { cookie })).status).toBe(400);
    expect((await t.request("/v1/backtest?asset=BTC&template=Buy%20Call&from=2026-09-05&to=2026-09-01", { cookie })).status).toBe(400);
    expect((await t.request("/v1/backtest?asset=BTC&template=Buy%20Call", { cookie })).status).toBe(503);
  });

  it("runs the template over the recorded days: entries per day, settlement on the expiry day, money to cents", async () => {
    clearEodMemo();
    for (let d = 0; d <= 5; d++) await snapshotOnce(t.deps, sourceOn(d), () => T0 + d * DAY + HOUR); // 13:00 each day: past the hour
    const res = await t.request("/v1/backtest?asset=BTC&template=Buy%20Call&lots=10&minDte=1", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const r = await json<BacktestResult>(res);
    expect(r).toMatchObject({ asset: "BTC", venue: "delta_india", template: "Buy Call", lots: 10, minDte: 1 });
    expect(r.coverage).toMatchObject({ firstDay: "2026-09-01", lastDay: "2026-09-06", days: 6 });
    // entries on 1..4 Sep settle on the 6th; on the 5th at 13:00 the 6th is 0.96 days away, so the 5th and 6th take October and stay open
    const closed = r.trades.filter((x) => x.status === "closed");
    expect(closed.map((x) => x.entryDay)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(closed.every((x) => x.exitDay === "2026-09-06" && x.expiry === "2026-09-06")).toBe(true);
    const first = closed[0]!;
    expect(first.legs[0]).toMatchObject({ kind: "call", side: "buy", strike: "80000", quantity: "0.01", price: "400", exitPrice: "3000" }); // 83 000 − 80 000 on the 6th
    expect(first.pnl).toBe("26"); // 0.01 × (3000 − 400)
    expect(first.entryCost).toBe("4");
    expect(r.stats.trades).toBe(4);
    expect(r.stats.winRate).toBe(1);
    expect(r.equity.at(-1)?.pnl).toBe(r.stats.total);
    expect(r.trades.filter((x) => x.status === "open")).toHaveLength(2);
    // a narrower entry range and a farther expiry rule: later days are still read so entries can settle, but October is beyond the data
    const oct = await json<BacktestResult>(await t.request("/v1/backtest?asset=BTC&template=Buy%20Call&minDte=14&from=2026-09-02&to=2026-09-03", { cookie }));
    expect(oct.trades.map((x) => [x.entryDay, x.expiry, x.status])).toEqual([
      ["2026-09-02", "2026-10-02", "open"],
      ["2026-09-03", "2026-10-02", "open"],
    ]);
    expect(oct.coverage.days).toBe(5); // 2 Sep to 6 Sep are read; entries only on the 2nd and 3rd
    expect(oct.coverage.entries).toBe(2);
    expect((await t.request("/v1/backtest?asset=BTC&template=Buy%20Call&minDte=0", { cookie })).status).toBe(400);
  });
});

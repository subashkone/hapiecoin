// Replay routes (ADR-079; HC-WS-113): behind the session, the expiries with a recorded chain, the daily and 5-minute
// instants of one expiry, the ladder at a day and at a pass, 404 for an instant nothing was recorded at, 503 before
// anything is recorded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instrument, type Quote, REPLAY_FINE_DAYS, type ReplayChain, type ReplayExpiries, type ReplaySteps } from "@hapiecoin/schema";
import { MARK_ROWS_RETENTION_DAYS, snapshotOnce, type MarketSource } from "../iv-snapshot.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let cookie: string;
const DAY = 86_400_000;
const HOUR = 3_600_000;
// the routes read the real clock for the 5-minute window, so the seeded passes sit on the nine days before today
const today = new Date();
const T0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 9, 12, 0, 0);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("replay@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: symbol.length + strike, isActive: true };
}
const EXPIRIES = ["2026-09-25", "2026-10-30"];
/** Listed only on the first five passes: settled since, so later passes carry no symbol of it. */
const SHORT = "2026-09-11";
const STRIKES = [78_000, 80_000, 82_000];
/** Two expiries, three strikes; the marks carry the pass index so instants are told apart. */
function sourceAt(passIndex: number, spot: number): MarketSource {
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of passIndex < 5 ? [...EXPIRIES, SHORT] : EXPIRIES)
    for (const k of STRIKES) {
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      quotes.push({ instrumentId: `delta_india:${c}`, ts: 0, mark: String(Math.max(spot - k, 0) + 300 + passIndex), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts: 0, mark: String(Math.max(k - spot, 0) + 300 + passIndex), oi: "1", spot: String(spot) });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}

describe("HC-WS-113 replay routes", () => {
  it("HC-WS-113 needs a session and is 503 before anything is recorded", async () => {
    expect((await t.request("/v1/replay/expiries?asset=BTC")).status).toBe(401);
    expect((await t.request("/v1/replay/expiries?asset=BTC", { cookie })).status).toBe(503);
    expect((await t.request("/v1/replay/steps?asset=BTC&expiry=2026-09-25", { cookie })).status).toBe(503);
    expect((await t.request("/v1/replay/steps?asset=BTC&expiry=nope", { cookie })).status).toBe(400);
  });

  it("HC-WS-113 lists the recorded expiries, the daily and 5-minute instants of one, and the ladder at a day and at a pass", async () => {
    // ten days of one 13:00 pass each (end-of-day chains), then three 5-minute passes on the last day
    let pass = 0;
    for (let d = 0; d <= 9; d++) await snapshotOnce(t.deps, sourceAt(pass++, 80_000 + d * 100), () => T0 + d * DAY + HOUR);
    for (let m = 1; m <= 3; m++) await snapshotOnce(t.deps, sourceAt(pass++, 81_000 + m), () => T0 + 9 * DAY + HOUR + m * 5 * 60_000);
    const ex = await json<ReplayExpiries>(await t.request("/v1/replay/expiries?asset=BTC", { cookie }));
    expect(ex).toEqual({ asset: "BTC", venue: "delta_india", expiries: [{ expiry: SHORT, days: 5, listed: false }, { expiry: "2026-09-25", days: 10, listed: true }, { expiry: "2026-10-30", days: 10, listed: true }] });
    // a settled expiry: no symbol of it in the latest pass, so its passes are read through its newest end-of-day row
    const settled = await json<ReplaySteps>(await t.request(`/v1/replay/steps?asset=BTC&expiry=${SHORT}`, { cookie }));
    expect(settled.daily).toHaveLength(5);
    expect(settled.fine.length).toBeLessThanOrEqual(5);
    const stepsRes = await t.request("/v1/replay/steps?asset=BTC&expiry=2026-09-25", { cookie });
    expect(stepsRes.headers.get("cache-control")).toBe("private, max-age=60");
    const steps = await json<ReplaySteps>(stepsRes);
    expect(steps.daily).toHaveLength(10);
    expect(steps.daily[0]).toEqual({ day: dayOf(T0), ts: new Date(T0 + HOUR).toISOString(), spot: 80_000 });
    // the 5-minute window is the last week of real time, and the marks themselves are kept for a week measured from the
    // last pass written (MARK_ROWS_RETENTION_DAYS): a pass older than either bound is not listed. The two bounds differ by
    // the time of day the suite runs at, which is why the expectation takes the later of them
    const lastPass = T0 + 9 * DAY + HOUR + 3 * 5 * 60_000;
    const since = Math.max(Date.now() - REPLAY_FINE_DAYS * DAY, lastPass - MARK_ROWS_RETENTION_DAYS * DAY);
    const expected = [...Array.from({ length: 10 }, (_, d) => ({ ts: T0 + d * DAY + HOUR, spot: 80_000 + d * 100 })), ...[1, 2, 3].map((m) => ({ ts: T0 + 9 * DAY + HOUR + m * 5 * 60_000, spot: 81_000 + m }))].filter((x) => x.ts >= since);
    expect(steps.fine.map((s) => s.spot)).toEqual(expected.map((x) => x.spot));
    expect(steps.fine.length).toBeGreaterThanOrEqual(3);
    // the ladder at the first day (end-of-day) and at the last 5-minute pass (marks)
    const day = await json<ReplayChain>(await t.request(`/v1/replay/chain?asset=BTC&expiry=2026-09-25&at=${encodeURIComponent(steps.daily[0]!.ts)}`, { cookie }));
    expect(day).toMatchObject({ source: "eod", spot: 80_000, at: steps.daily[0]!.ts });
    expect(day.rows).toEqual([
      { strike: "78000", call: { mark: 2300, iv: 0.4 }, put: { mark: 300, iv: null } },
      { strike: "80000", call: { mark: 300, iv: 0.4 }, put: { mark: 300, iv: null } },
      { strike: "82000", call: { mark: 300, iv: 0.4 }, put: { mark: 2300, iv: null } },
    ]);
    const last = steps.fine.at(-1)!;
    const fine = await json<ReplayChain>(await t.request(`/v1/replay/chain?asset=BTC&expiry=2026-09-25&at=${encodeURIComponent(last.ts)}`, { cookie }));
    expect(fine).toMatchObject({ source: "marks", spot: 81_003 });
    expect(fine.rows.map((r) => r.strike)).toEqual(["78000", "80000", "82000"]);
    expect(fine.rows[1]!.call!.mark).toBe(1003 + 300 + 12); // 81 003 − 80 000 + 300 + pass index 12
    // the other expiry's rows never leak in; an instant nothing was recorded at is 404
    expect(fine.rows.every((r) => r.call !== null && r.put !== null)).toBe(true);
    expect((await t.request(`/v1/replay/chain?asset=BTC&expiry=2026-09-25&at=${encodeURIComponent(new Date(T0 + 5 * HOUR).toISOString())}`, { cookie })).status).toBe(404);
    expect((await t.request("/v1/replay/steps?asset=ETH&expiry=2026-09-25", { cookie })).status).toBe(503);
  });
});

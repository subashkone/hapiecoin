// The strategy fetchers against the in-memory mock API: every route the hooks call, with the response schema.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, type MockFetch } from "../../../test/helpers";
import { createApiClient } from "./client";
import { strategyFetchers } from "./strategies";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs("fetch@example.com");
});
afterEach(() => mock.restore());

const CALL = { kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", iv: 0.5 };

describe("[API] strategy fetchers (ADR-024)", () => {
  it("create, list by status, get one, patch, start, pnl, close all, archive / restore, delete", async () => {
    const f = strategyFetchers(createApiClient());
    const s = await f.create({ name: "Fetch me", asset: "BTC", templateName: "Custom", legs: [CALL] });
    expect(s.status).toBe("draft");
    expect((await f.list("draft")).map((x) => x.id)).toEqual([s.id]);
    expect(await f.list("paper")).toEqual([]);
    expect((await f.one(s.id)).name).toBe("Fetch me");
    const renamed = await f.patch(s.id, { name: "Renamed", tags: ["x"] });
    expect(renamed.name).toBe("Renamed");
    const started = await f.start(s.id, { mode: "paper", brokerId: "brk_delta", entries: { [s.legs[0]!.id]: "1250" } });
    expect(started.status).toBe("paper");
    expect(started.legs[0]!.entryPrice).toBe("1250");
    const withPnl = await f.pnl(s.id, { day: "2026-09-08", pnl: "3.5" });
    expect(withPnl.pnlHistory).toEqual([{ day: "2026-09-08", pnl: "3.5" }]);
    const adjusted = await f.addLegs(s.id, { legs: [{ ...CALL, side: "sell", strike: "82000", symbol: "C-BTC-82000-250926" }] });
    expect(adjusted.legs).toHaveLength(2);
    const closed = await f.closeAll(s.id, { exits: Object.fromEntries(adjusted.legs.map((l) => [l.id, "1300"])) });
    expect(closed.legs.every((l) => l.status === "squared_off")).toBe(true);
    expect(closed.realizedPnl).toBe("-0.5"); // +0.5 on the bought call, −1.0 on the sold call
    const stopped = await f.stop(s.id, { archive: true, exits: {} });
    expect(stopped.status).toBe("archived");
    const back = await f.restore(s.id);
    expect(back.status).toBe("draft");
    const arch = await f.archive(s.id);
    expect(arch.status).toBe("archived");
    await f.remove(s.id);
    expect(await f.list()).toEqual([]);
  });
});

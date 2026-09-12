// The live-trading fetchers and the positions query against the in-memory mock API (ADR-025).
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { createApiClient } from "./client";
import { liveFetchers, newIdempotencyKey, useLivePositions } from "./live";
import { strategyFetchers } from "./strategies";

const EMAIL = "livefetch@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  mock.state.accounts.get(EMAIL)!.credentials = [{ id: "crd_main", label: "Main", brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: "2026-09-08T09:00:00Z", whitelistedIp: "203.0.113.10" }];
});
afterEach(() => mock.restore());

const CALL = { kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", iv: 0.5 };

function Positions({ brokerId }: { brokerId: string | null }) {
  const q = useLivePositions(brokerId);
  return <div data-testid="positions">{q.data ? q.data.positions.map((p) => `${p.symbol}:${p.size}`).join(",") : q.status}</div>;
}

describe("[API] live fetchers", () => {
  it("preview, place with an idempotency key, retry, sync and batch", async () => {
    const f = liveFetchers(createApiClient());
    const s = strategyFetchers(createApiClient());
    const d = await s.create({ name: "Live me", asset: "BTC", templateName: "Custom", venue: "delta_india", legs: [{ ...CALL, symbol: "C-BTC-FAIL-250926" }] });
    const p = await f.preview(d.id, { brokerId: "brk_delta", worstLoss: -12 });
    expect(p.ok).toBe(true);
    expect(p.legs[0]).toMatchObject({ symbol: "C-BTC-FAIL-250926", contracts: 10 });
    const key = newIdempotencyKey();
    expect(key).toMatch(/^web-[0-9a-f-]{36}$/);
    const live = await f.place(d.id, { brokerId: "brk_delta", idempotencyKey: key, expected: {} });
    expect(live.status).toBe("live");
    expect(live.orders[0]!.state).toBe("failed");
    expect((await f.place(d.id, { brokerId: "brk_delta", idempotencyKey: key, expected: {} })).orders).toHaveLength(1); // idempotent
    const retried = await f.retry(d.id);
    expect(retried.orders[0]).toMatchObject({ state: "filled", attempts: 2 });
    expect((await f.sync(d.id)).id).toBe(d.id);
    const other = await s.create({ name: "Batch me", asset: "BTC", templateName: "Custom", venue: "delta_india", legs: [CALL] });
    await s.start(other.id, { mode: "paper", brokerId: "brk_delta", entries: { [other.legs[0]!.id]: "1200" } });
    const batch = await f.batch({ ids: [other.id, "strat_nope"], brokerId: "brk_delta", idempotencyKey: newIdempotencyKey() });
    expect(batch).toEqual({ placed: [other.id], failed: null, skipped: ["strat_nope"] });
    const pos = await f.positions("brk_delta");
    expect(pos.positions.map((x) => x.symbol).sort()).toEqual(["C-BTC-80000-250926", "C-BTC-OK-250926"]);
  });

  it("useLivePositions waits for an exchange and then lists the venue positions", async () => {
    const f = liveFetchers(createApiClient());
    const s = strategyFetchers(createApiClient());
    const d = await s.create({ name: "Pos", asset: "BTC", templateName: "Custom", venue: "delta_india", legs: [CALL] });
    await f.place(d.id, { brokerId: "brk_delta", idempotencyKey: newIdempotencyKey(), expected: {} });
    const { rerender } = renderWithProviders(<Positions brokerId={null} />);
    expect(screen.getByTestId("positions").textContent).toBe("pending");
    act(() => rerender(<Positions brokerId="brk_delta" />));
    await waitFor(() => expect(screen.getByTestId("positions").textContent).toBe("C-BTC-80000-250926:10"));
  });
});

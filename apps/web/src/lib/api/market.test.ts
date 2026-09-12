import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { marketFetchers, marketKeys } from "./market";

describe("HC-SH-124 market history asks for the venue's rows (ADR-069)", () => {
  it("sends venue= only off the default venue and keys the cache by venue", async () => {
    const get = vi.fn(() => Promise.resolve({}));
    const f = marketFetchers({ get } as unknown as ApiClient);
    await f.iv("BTC");
    await f.iv("BTC", "deribit");
    await f.marks("C-BTC-80000-250926", 24);
    await f.marks("BTC-25SEP26-80000-C", 6, "deribit");
    expect(get.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "/v1/market/iv?asset=BTC",
      "/v1/market/iv?asset=BTC&venue=deribit",
      "/v1/market/marks/C-BTC-80000-250926?hours=24",
      "/v1/market/marks/BTC-25SEP26-80000-C?hours=6&venue=deribit",
    ]);
    expect(marketKeys.iv("BTC")).toEqual(["market", "iv", "delta_india", "BTC"]);
    expect(marketKeys.marks("X", 24, "deribit")).toEqual(["market", "marks", "deribit", "X", 24]);
  });
});

// /s/:code landing (HC-WS-106): a valid link loads its legs into the store at the shared prices and goes to Analyse;
// a bad code explains itself and offers Analyse.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { routerMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { encodeShare } from "@/lib/strategy/share";
import { ShareLanding } from "./ShareLanding";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  routerMock.replace.mockClear();
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, workspaceTab: "chain" });
});
afterEach(() => mock.restore());

describe("HC-WS-106 shared strategy route", () => {
  it("loads the legs, names the strategy, keeps the shared prices and replaces the route with /analyse", async () => {
    const code = encodeShare({ asset: "ETH", name: "Bull Call Spread", legs: [
      { kind: "call", side: "buy", strike: "4200", expiry: "2026-09-25", lots: 3, price: "150.5", iv: 0.6 },
      { kind: "call", side: "sell", strike: "4400", expiry: "2026-09-25", lots: 3, price: "80", iv: undefined },
    ] });
    renderWithProviders(<ShareLanding code={code} />);
    expect(screen.getByTestId("share-landing").dataset["state"]).toBe("ready");
    expect(screen.getByTestId("share-landing").dataset["legs"]).toBe("2");
    expect(screen.getByText(/Bull Call Spread · ETH/)).toBeTruthy();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/analyse"));
    const st = useUiStore.getState();
    expect(st.asset).toBe("ETH");
    expect(st.legs.ETH.map((l) => [l.side, l.strike, l.lots, l.price])).toEqual([["buy", "4200", 3, "150.5"], ["sell", "4400", 3, "80"]]);
    expect(st.legs.ETH[0]!.symbol).toBe("C-ETH-4200-250926");
    expect(st.strategy.ETH).toMatchObject({ name: "Bull Call Spread", priceMode: "custom", draftId: null });
    expect(st.workspaceTab).toBe("builder");
  });
  it("an invalid code explains itself and loads nothing", () => {
    renderWithProviders(<ShareLanding code="nope" />);
    expect(screen.getByTestId("share-landing").dataset["state"]).toBe("invalid");
    expect(screen.getByText(/not a HapieCoin strategy/)).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(useUiStore.getState().legs.BTC).toHaveLength(0);
  });
});

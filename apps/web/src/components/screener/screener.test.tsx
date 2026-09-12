// Options screener panel (ADR-076; HC-WS-110..112) against the fake gateway: two expiries served, the rows, sort,
// filters, the Expiries view, Buy / Sell into the Builder and Chain to the chain tab.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";

const NEAR = "2026-09-25";
const FAR = "2026-10-30";
const near = buildChain("BTC", NEAR);
const far = buildChain("BTC", FAR);
let mock: MockFetch;

/** Open the socket, then wait until the expiries are known and every chain topic is asked for (the far one last). */
async function subscribed() {
  act(() => FakeSocket.last().open());
  await waitFor(() => expect(FakeSocket.last().sentFrames().flatMap((f) => (f as { topics?: string[] }).topics ?? [])).toContain(chainTopic("delta_india", "BTC", FAR)), { timeout: 5000 });
}

function serve() {
  const ws = FakeSocket.last();
  act(() => {
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: chainTopic("delta_india", "BTC", NEAR), seq: 0, rows: near });
    ws.receive({ t: "snap", topic: chainTopic("delta_india", "BTC", FAR), seq: 0, rows: far });
  });
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs("screener@example.com");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({ asset: "BTC", expiry: { BTC: NEAR }, legs: { BTC: [], ETH: [], XAUT: [] }, workspaceTab: "screener", builderTab: "builder", chainLots: 10, analysisTab: "payoff", paneSource: null, adjust: null });
});
afterEach(() => mock.restore());

const panel = () => screen.getByTestId("screener-panel");
const table = () => screen.getByTestId("table-screener-strikes");
/** Body cells of the column whose header starts with `label` (the column menu may hide or move columns). */
const cells = (label: string) => {
  const col = within(table()).getAllByRole("columnheader").findIndex((th) => (th.textContent ?? "").startsWith(label));
  expect(col).toBeGreaterThanOrEqual(0);
  return within(table()).getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[col]!.textContent ?? "");
};

describe("HC-WS-110 the Screener tab", () => {
  it("lists every quoted option of every priced expiry, sorted by premium per day, with the basis line; the filters and the sort work", async () => {
    renderWithProviders(<Workspace />);
    expect(screen.getByTestId("tab-screener")).toBeTruthy();
    await waitFor(() => expect(panel().dataset["state"]).not.toBe("no-expiries"));
    // the chains are subscribed once the expiries are known
    await subscribed();
    serve();
    await waitFor(() => expect(panel().dataset["state"]).toBe("ready"));
    const total = Number(panel().dataset["total"]);
    const quoted = [...near, ...far].reduce((n, r) => n + (r.call ? 1 : 0) + (r.put ? 1 : 0), 0);
    expect(total).toBe(quoted);
    // the mock lists more expiries than the two served: the basis line counts the priced ones against the listed ones
    expect(screen.getByTestId("screener-basis").textContent).toContain(`${quoted} options on 2 of `);
    expect(screen.getByTestId("screener-basis").textContent).toContain("expiries · basis mark · ");
    expect(screen.getByTestId("screener-basis").textContent).toContain("spot 79,521");
    expect(table().dataset["sort"]).toBe("premiumPerDay");
    expect(table().dataset["dir"]).toBe("desc");
    // premium per day descends down the table
    const prem = cells("Prem/day").map((t) => Number(t.replace(/,/g, "")));
    for (let i = 1; i < prem.length; i++) expect(prem[i - 1]).toBeGreaterThanOrEqual(prem[i]!);
    expect(Number(table().dataset["rows"])).toBeLessThanOrEqual(100);
    expect(screen.getByTestId("screener-count").textContent).toMatch(/Top 100 of \d+|\d+ of \d+ options/);
    const u = userEvent.setup();
    // side, |Δ| band, one expiry, min OI
    await u.click(screen.getByTestId("screener-side-put"));
    expect(new Set(cells("Side"))).toEqual(new Set(["P"]));
    await u.click(screen.getByTestId("screener-delta-0.100.30"));
    for (const d of cells("|Δ|").map(Number)) {
      expect(d).toBeGreaterThan(0.1);
      expect(d).toBeLessThanOrEqual(0.3);
    }
    await u.click(screen.getByTestId(`screener-expiry-${NEAR}`)); // keeps only the near expiry
    expect(new Set(cells("Expiry"))).toEqual(new Set(["25 Sep"]));
    await u.click(screen.getByTestId("screener-expiries-all"));
    fireEvent.change(screen.getByTestId("screener-min-oi"), { target: { value: "999999999" } });
    expect(Number(panel().dataset["rows"])).toBe(0);
    expect(within(table()).getByText("No option fits these filters")).toBeTruthy();
    fireEvent.change(screen.getByTestId("screener-min-oi"), { target: { value: "0" } });
    await u.click(screen.getByTestId("screener-side-both"));
    await u.click(screen.getByTestId("screener-delta-any"));
    // a header click sorts by that column
    await u.click(within(table()).getByText("IV"));
    expect(table().dataset["sort"]).toBe("iv");
  });

  it("HC-WS-111 the Expiries view carries days, ATM IV, 25Δ skew, expected move and OI per expiry", async () => {
    renderWithProviders(<Workspace />);
    await subscribed();
    serve();
    await waitFor(() => expect(panel().dataset["state"]).toBe("ready"));
    const u = userEvent.setup();
    await u.click(screen.getByTestId("screener-view-expiries"));
    const t = screen.getByTestId("table-screener-expiries");
    expect(t.dataset["rows"]).toBe("2");
    const rows = within(t).getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain("25 Sep");
    expect(rows[0]!.textContent).toMatch(/\d+\.\d%/); // ATM IV
    expect(rows[0]!.textContent).toContain("pts"); // 25Δ skew
    expect(rows[0]!.textContent).toContain("±"); // expected move
    expect(screen.getByTestId("screener-side-put").hasAttribute("disabled")).toBe(true); // strike filters rest
  });

  it("HC-WS-112 Buy / Sell add a Builder leg at the chain lots from the row's quote; Chain opens that expiry in the chain tab", async () => {
    renderWithProviders(<Workspace />);
    await subscribed();
    serve();
    await waitFor(() => expect(panel().dataset["state"]).toBe("ready"));
    const u = userEvent.setup();
    const first = within(table()).getAllByRole("row")[1]!;
    const expiryText = first.querySelectorAll("td")[0]!.textContent;
    await u.click(within(first).getByTestId("screener-buy"));
    let legs = useUiStore.getState().legs.BTC;
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ side: "buy", lots: 10 });
    expect([NEAR, FAR]).toContain(legs[0]!.expiry);
    expect([...near, ...far].some((r) => r.strike === legs[0]!.strike)).toBe(true);
    await u.click(within(first).getByTestId("screener-sell"));
    legs = useUiStore.getState().legs.BTC;
    expect(legs).toHaveLength(2);
    expect(legs[1]!.side).toBe("sell");
    await u.click(within(first).getByTestId("screener-chain"));
    expect(useUiStore.getState().workspaceTab).toBe("chain");
    expect(useUiStore.getState().expiry.BTC).toBe(expiryText === "30 Oct" ? FAR : NEAR);
  });
});

// HapieCoin Assistant (HC-SH-057..063, 110, 111): launcher, panel, chips, typed answers, visitor mode, drag position,
// palette hand-off and the strategy explainer on /analyse.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { pathnameMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { ASSISTANT_POS_KEY, Assistant, SUPPORT_EMAIL } from "./Assistant";

const EXPIRY = "2026-09-25";
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;
beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  useUiStore.setState({ asset: "BTC", expiry: { BTC: EXPIRY }, legs: { BTC: [], ETH: [], XAUT: [] }, assistantRequested: 0, assistantQuestion: null });
});
afterEach(() => mock.restore());

const lastBot = () => screen.getAllByTestId("assistant-msg-bot").at(-1)!;
const settled = async (text: string) =>
  waitFor(() => {
    expect(screen.getByTestId("assistant-panel").dataset["typing"]).toBe("false");
    expect(lastBot().textContent).toContain(text);
  }, { timeout: 4000 });

describe("HC-SH-057..063 assistant panel", () => {
  it("opens from the launcher with a greeting and chips, types an answer, and closes on Escape", async () => {
    mock.loginAs("trader@example.com");
    pathnameMock.value = "/subscription";
    renderWithProviders(<Assistant />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("assistant-launcher")).toBeTruthy());
    await u.click(screen.getByTestId("assistant-launcher"));
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("assistant-mode").textContent).toContain("Platform help"));
    const chips = screen.getAllByTestId("assistant-chip");
    expect(chips).toHaveLength(4);
    expect(chips[0]?.textContent).toBe("How do I add a leg from the chain?");
    expect(screen.queryByTestId("assistant-explain")).toBeNull(); // not on Analyse
    await u.click(chips[1]!);
    expect(screen.getByTestId("assistant-msg-me").textContent).toBe("What is probability of profit?");
    await settled("statistical estimate, not a promise");
    expect(screen.getByTestId("assistant-email").getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
    await u.type(screen.getByTestId("assistant-input"), "nonsense question{Enter}");
    await settled("I can help with using HapieCoin");
    expect(screen.getAllByTestId("assistant-msg-me")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
    await u.click(screen.getByTestId("assistant-launcher"));
    expect(screen.getAllByTestId("assistant-msg-me")).toHaveLength(2); // conversation kept for the session
    await u.click(screen.getByTestId("assistant-close"));
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });

  it("runs in limited visitor mode when signed out and ignores empty submits", async () => {
    pathnameMock.value = "/";
    renderWithProviders(<Assistant />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("assistant-launcher"));
    expect(screen.getByTestId("assistant-mode").textContent).toContain("visitor mode");
    expect(screen.getByTestId("assistant-send").hasAttribute("disabled")).toBe(true);
    fireEvent.submit(screen.getByTestId("assistant-input").closest("form")!);
    expect(screen.queryByTestId("assistant-msg-me")).toBeNull();
    await u.click(screen.getAllByTestId("assistant-chip")[0]!);
    await settled("You are in visitor mode");
  });

  it("opens with a question from the palette and can be dragged; the position is remembered", async () => {
    pathnameMock.value = "/";
    renderWithProviders(<Assistant />);
    act(() => useUiStore.getState().openAssistant("what is pop"));
    await waitFor(() => expect(screen.getByTestId("assistant-msg-me").textContent).toBe("what is pop"));
    await settled("Probability of profit");
    const btn = screen.getByTestId("assistant-launcher");
    btn.setPointerCapture = vi.fn();
    fireEvent.pointerDown(btn, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(btn, { clientX: 502, clientY: 501, pointerId: 1 }); // below the drag threshold
    fireEvent.pointerMove(btn, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(btn, { pointerId: 1 });
    expect(screen.getByTestId("assistant-panel")).toBeTruthy(); // a drag is not a click
    const saved = JSON.parse(localStorage.getItem(ASSISTANT_POS_KEY) ?? "{}") as { x?: number; y?: number };
    expect(typeof saved.x).toBe("number");
    expect(btn.style.left).not.toBe("");
    // a plain tap toggles, keyboard toggles too
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerUp(btn, { pointerId: 2 });
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
    fireEvent.pointerUp(btn, { pointerId: 3 }); // no pointerDown first: ignored
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
  });

  it("restores a saved position and tolerates a corrupt one", async () => {
    localStorage.setItem(ASSISTANT_POS_KEY, JSON.stringify({ x: 40, y: 50 }));
    pathnameMock.value = "/";
    const r = renderWithProviders(<Assistant />);
    await waitFor(() => expect(screen.getByTestId("assistant-launcher").style.left).toBe("40px"));
    r.unmount();
    localStorage.setItem(ASSISTANT_POS_KEY, "{bad");
    renderWithProviders(<Assistant />);
    expect(screen.getByTestId("assistant-launcher").style.left).toBe("");
  });
});

describe("HC-SH-110 explain this strategy", () => {
  it("summarises the Builder legs with live pricing on /analyse", async () => {
    mock.loginAs("trader@example.com");
    pathnameMock.value = "/analyse";
    const s = useUiStore.getState();
    const row = rows.find((r) => Number(r.strike) >= 79521)!;
    s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: row.strike, expiry: EXPIRY, lots: 10, price: row.call!.mark, iv: row.call!.markIv });
    renderWithProviders(<Assistant />);
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
      ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
      ws.receive({ t: "snap", topic: chainTopic("delta_india", "BTC", EXPIRY), seq: 0, rows });
    });
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("assistant-launcher")).toBeTruthy());
    await u.click(screen.getByTestId("assistant-launcher"));
    await waitFor(() => expect(screen.getByTestId("assistant-explain")).toBeTruthy());
    expect(screen.getAllByTestId("assistant-chip")[0]?.textContent).toBe("Explain this strategy");
    await waitFor(() => expect(screen.getByTestId("assistant-explain")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 300)); // let the engine price the leg
    await u.click(screen.getByTestId("assistant-explain"));
    await settled("not financial advice");
    expect(lastBot().textContent).toContain("Buy 10 ×");
    expect(lastBot().textContent).toMatch(/Max profit|could not price/);
  });
});

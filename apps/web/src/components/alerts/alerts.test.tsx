// Alerts center, bell and engine against the in-memory API and the fake gateway (ADR-052; HC-SH-079, 094..100,
// HC-TR-114, 120, 139).
import { chainTopic, type Alert, type Strategy } from "@hapiecoin/schema";
import { expiryMs } from "@hapiecoin/pricing";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { AlertEngine } from "@/lib/alerts/AlertEngine";
import { resetReadings } from "@/lib/alerts/readings";
import { useUiStore } from "@/lib/store";
import { AlertsBell } from "./AlertsBell";
import { AlertsDialog } from "./AlertsDialog";

const EMAIL = "alerts@example.com";
// the first default expiry that is still live at the clock: what the IV probe subscribes to (the list is env.ts's
// default; an expiry drops out of it after its settlement hour, so a literal date would fail after 12:00 UTC that day)
const DEFAULT_EXPIRIES = "2026-09-11,2026-09-18,2026-09-25,2026-10-30,2026-11-27".split(",");
const firstLiveDefault = () => DEFAULT_EXPIRIES.find((d) => expiryMs(d, 12) > Date.now()) ?? DEFAULT_EXPIRIES[DEFAULT_EXPIRIES.length - 1]!;
const EXPIRY = firstLiveDefault();
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;
const mine = () => mock.state.accounts.get(EMAIL)!.alerts;
const seed = (a: Partial<Alert>): Alert => {
  const at = "2026-09-10T00:00:00.000Z";
  const alert: Alert = { id: `alr_${mine().length + 1}`, kind: "price", asset: "BTC", strategyId: null, strategyName: null, op: ">=", value: "82000", channels: ["push"], state: "armed", lastValue: null, triggeredAt: null, createdAt: at, updatedAt: at, ...a };
  mine().unshift(alert);
  return alert;
};

function Harness() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  return (
    <>
      <AlertsBell />
      <AlertEngine throttleMs={0} />
      <AlertsDialog open={dialog === "alerts"} onOpenChange={(o) => !o && close()} />
    </>
  );
}
const opened = new WeakSet<FakeSocket>();
function serveSpot(price: string) {
  const ws = FakeSocket.last();
  act(() => {
    if (!opened.has(ws)) {
      ws.open();
      opened.add(ws);
    }
    ws.receive({ t: "spot", s: "BTC", p: price, c24: 0.4 });
  });
  return ws;
}

beforeEach(() => {
  FakeSocket.reset();
  resetReadings();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ asset: "BTC", dialog: null, alertPrefill: null, dialogsTouched: false });
});
afterEach(() => mock.restore());

describe("HC-SH-079 / HC-SH-097..099 the bell and the Alerts center", () => {
  it("empty state → New alert form → a saved price alert armed at once; pause and delete", async () => {
    renderWithProviders(<Harness />);
    serveSpot("79521");
    const u = userEvent.setup();
    const bell = screen.getByTestId("alerts-bell");
    await waitFor(() => expect(bell.dataset["armed"]).toBe("0"));
    expect(screen.queryByTestId("alerts-badge")).toBeNull();
    await u.click(bell);
    const dialog = screen.getByTestId("alerts-dialog");
    expect(within(dialog).getByTestId("alerts-counts").textContent).toBe("0 alerts · 0 armed · 0 triggered");
    expect(within(dialog).getByTestId("alerts-empty").textContent).toContain("No alerts yet");
    await u.click(within(dialog).getByTestId("alerts-empty-new"));
    const form = within(dialog).getByTestId("alert-form");
    // the form knows the live reading for the chosen type and asset
    await waitFor(() => expect(within(form).getByTestId("alert-form-now").textContent).toBe("now 79,521.0"));
    // validation: a value is required, then a channel
    await u.click(within(form).getByTestId("alert-save"));
    await waitFor(() => expect(screen.getByText("Enter a value")).toBeTruthy());
    fireEvent.change(within(form).getByTestId("alert-value"), { target: { value: "90000" } });
    await u.click(within(form).getByTestId("alert-ch-push")); // untick the default channel
    await u.click(within(form).getByTestId("alert-save"));
    await waitFor(() => expect(screen.getByText("Pick a channel")).toBeTruthy());
    await u.click(within(form).getByTestId("alert-ch-email"));
    fireEvent.change(within(form).getByTestId("alert-op"), { target: { value: ">=" } });
    await u.click(within(form).getByTestId("alert-save"));
    await waitFor(() => expect(within(dialog).getAllByTestId("alert-row")).toHaveLength(1));
    expect(screen.getByText("Alert saved")).toBeTruthy();
    const row = within(dialog).getByTestId("alert-row");
    expect(row.dataset["state"]).toBe("armed");
    expect(within(row).getByTestId("alert-condition").textContent).toBe("BTC ≥ 90,000.0");
    expect(within(row).getByTestId("alert-now").textContent).toBe("Price · now 79,521.0");
    expect(within(row).getAllByTestId("alert-channel").map((c) => c.textContent)).toEqual(["email"]);
    expect(within(row).getByTestId("alert-state").textContent).toBe("armed");
    expect(within(dialog).getByTestId("alerts-counts").textContent).toBe("1 alert · 1 armed · 0 triggered");
    expect(mine()).toMatchObject([{ kind: "price", op: ">=", value: "90000", channels: ["email"], state: "armed" }]);
    await waitFor(() => expect(screen.getByTestId("alerts-badge").textContent).toBe("1"));
    expect(screen.getByTestId("alerts-bell").dataset["triggered"]).toBe("0");
    // the switch pauses; the badge goes away
    await u.click(within(row).getByTestId("alert-arm"));
    await waitFor(() => expect(within(dialog).getByTestId("alert-row").dataset["state"]).toBe("paused"));
    await waitFor(() => expect(screen.queryByTestId("alerts-badge")).toBeNull());
    expect(within(dialog).getByTestId("alerts-counts").textContent).toBe("1 alert · 0 armed · 0 triggered · 1 paused");
    // delete asks once
    await u.click(within(dialog).getByTestId("alert-delete"));
    await u.click(within(dialog).getByTestId("alert-delete-confirm"));
    await waitFor(() => expect(within(dialog).queryAllByTestId("alert-row")).toHaveLength(0));
    expect(within(dialog).getByTestId("alerts-empty")).toBeTruthy();
    expect(mine()).toEqual([]);
  });
});

describe("HC-SH-096 the engine", () => {
  it("fires an armed price alert on the tick that meets it, toasts, turns the bell red; re-arming from the switch fires again", async () => {
    seed({ id: "alr_p", op: "<=", value: "80000", channels: ["push", "email"] });
    renderWithProviders(<Harness />);
    await waitFor(() => expect(screen.getByTestId("alerts-badge").textContent).toBe("1"));
    serveSpot("79521");
    await waitFor(() => expect(mine()[0]).toMatchObject({ state: "triggered", lastValue: "79521" }));
    await waitFor(() => expect(screen.getByText("Alert triggered")).toBeTruthy());
    expect(screen.getByText("BTC crossed 80,000.0 · Sent via push, email")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("alerts-bell").dataset["triggered"]).toBe("1"));
    expect(screen.getByTestId("alerts-badge").className).toContain("bg-loss");
    // the dialog shows the firing; the switch re-arms and the still-met condition fires again
    const u = userEvent.setup();
    await u.click(screen.getByTestId("alerts-bell"));
    const dialog = screen.getByTestId("alerts-dialog");
    const row = within(dialog).getByTestId("alert-row");
    expect(row.dataset["state"]).toBe("triggered");
    expect(within(row).getByTestId("alert-now").textContent).toContain("fired");
    await u.click(within(row).getByTestId("alert-arm"));
    await waitFor(() => expect(mine()[0]!.state).toBe("armed"));
    // the reading in hand (79,521) already meets it, so re-arming fires again without waiting for a tick
    await waitFor(() => expect(mine()[0]).toMatchObject({ state: "triggered", lastValue: "79521" }));
    await waitFor(() => expect(within(dialog).getByTestId("alert-row").dataset["state"]).toBe("triggered"));
    // an alert the readings do not meet stays armed
    seed({ id: "alr_q", op: ">=", value: "99000" });
    serveSpot("79300");
    await new Promise((r) => setTimeout(r, 30));
    expect(mine().find((a) => a.id === "alr_q")!.state).toBe("armed");
  });

  it("evaluates an ATM IV alert from the nearest expiry chain", async () => {
    seed({ id: "alr_iv", kind: "iv", op: "<=", value: "100", channels: ["email"] });
    renderWithProviders(<Harness />);
    const ws = serveSpot("79521");
    const topic = chainTopic("delta_india", "BTC", EXPIRY);
    await waitFor(() => expect(ws.sentFrames().some((f) => JSON.stringify(f).includes(topic))).toBe(true));
    act(() => {
      ws.receive({ t: "snap", topic, seq: 0, rows });
    });
    await waitFor(() => expect(mine()[0]!.state).toBe("triggered"));
    expect(Number(mine()[0]!.lastValue)).toBeGreaterThan(0);
    expect(Number(mine()[0]!.lastValue)).toBeLessThanOrEqual(100);
  });
});

describe("HC-SH-100 / HC-TR-139 the Set alert hook", () => {
  it("openAlerts with a strategy prefill lands on the P&L form with the strategy chosen; saving snapshots its name", async () => {
    const at = "2026-09-10T00:00:00.000Z";
    const s: Strategy = { id: "strat_1", name: "Bull Call Spread", asset: "BTC", status: "paper", tradingMode: "paper", templateName: "Bull Call Spread", brokerId: "brk_delta", legs: [], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orders: [], adjustments: [], orderBatchId: null, startedAt: at, closedAt: null, createdAt: at, updatedAt: at };
    mock.state.accounts.get(EMAIL)!.strategies.push(s);
    renderWithProviders(<Harness />);
    serveSpot("79521");
    act(() => useUiStore.getState().openAlerts({ kind: "pnl", strategyId: "strat_1", asset: "BTC" }));
    const dialog = await screen.findByTestId("alerts-dialog");
    const form = within(dialog).getByTestId("alert-form");
    expect(within(form).getByTestId<HTMLSelectElement>("alert-kind").value).toBe("pnl");
    await waitFor(() => expect(within(form).getByTestId<HTMLSelectElement>("alert-strategy").value).toBe("strat_1"));
    expect(within(form).getByText(/Value · USD P&L/)).toBeTruthy();
    fireEvent.change(within(form).getByTestId("alert-value"), { target: { value: "20" } });
    const u = userEvent.setup();
    await u.click(within(form).getByTestId("alert-save"));
    await waitFor(() => expect(within(dialog).getByTestId("alert-condition").textContent).toBe("Bull Call Spread · P&L ≥ +$20.00"));
    expect(mine()[0]).toMatchObject({ kind: "pnl", strategyId: "strat_1", strategyName: "Bull Call Spread", asset: "BTC" });
    // reopening from the bell shows the list, not the form
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("alerts-dialog")).toBeNull());
    await u.click(screen.getByTestId("alerts-bell"));
    expect(within(screen.getByTestId("alerts-dialog")).queryByTestId("alert-form")).toBeNull();
  });
});

describe("ADR-057 Telegram delivery", () => {
  it("connects through the bot deep link, enables the telegram channel, sends a test, disconnects; an unconfigured server says so", async () => {
    renderWithProviders(<Harness />);
    serveSpot("79521");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("alerts-bell"));
    const dialog = screen.getByTestId("alerts-dialog");
    await waitFor(() => expect(within(dialog).getByTestId("telegram-status").dataset["state"]).toBe("unlinked"));
    await u.click(within(dialog).getByTestId("alerts-empty-new"));
    // the channel is disabled until the chat is linked
    expect(within(dialog).getByTestId("alert-ch-telegram").hasAttribute("disabled")).toBe(true);
    await u.click(within(dialog).getByTestId("telegram-connect"));
    await waitFor(() => expect(within(dialog).getByTestId("telegram-status").dataset["state"]).toBe("pending"));
    expect(within(dialog).getByTestId("telegram-link").getAttribute("href")).toMatch(/^https:\/\/t\.me\/HapieCoinMockBot\?start=LINK/);
    expect(within(dialog).getByTestId("telegram-code").textContent).toMatch(/^code LINK/);
    // the mock links on the next status poll (the person pressed Start)
    await waitFor(() => expect(within(dialog).getByTestId("telegram-status").dataset["state"]).toBe("linked"), { timeout: 6000 });
    expect(within(dialog).getByTestId("telegram-status").textContent).toContain("connected");
    await waitFor(() => expect(within(dialog).getByTestId("alert-ch-telegram").hasAttribute("disabled")).toBe(false));
    await u.click(within(dialog).getByTestId("alert-ch-telegram"));
    fireEvent.change(within(dialog).getByTestId("alert-value"), { target: { value: "95000" } });
    await u.click(within(dialog).getByTestId("alert-save"));
    await waitFor(() => expect(within(dialog).getAllByTestId("alert-row")).toHaveLength(1));
    expect(within(dialog).getAllByTestId("alert-channel").map((c) => c.textContent)).toEqual(["push", "telegram"]);
    expect(mine()[0]!.channels).toEqual(["push", "telegram"]);
    await u.click(within(dialog).getByTestId("telegram-test"));
    await waitFor(() => expect(screen.getByText("Test message sent")).toBeTruthy());
    await u.click(within(dialog).getByTestId("telegram-unlink"));
    await waitFor(() => expect(within(dialog).getByTestId("telegram-status").dataset["state"]).toBe("unlinked"));
    expect(mock.state.accounts.get(EMAIL)!.telegram.chatId).toBeNull();
  });

  it("reads 'not configured' when the server has no bot token", async () => {
    mock.state.telegramConfigured = false;
    renderWithProviders(<Harness />);
    act(() => useUiStore.getState().openAlerts({}));
    const dialog = await screen.findByTestId("alerts-dialog");
    await waitFor(() => expect(within(dialog).getByTestId("telegram-status").dataset["state"]).toBe("off"));
    expect(within(dialog).getByTestId("alert-ch-telegram").hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByTestId("alert-form").textContent).toContain("telegramoff");
  });
});

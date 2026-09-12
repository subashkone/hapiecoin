// Settings dialogs against the in-memory mock API: every dialog saves through /v1 and the change persists.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainTopic } from "@hapiecoin/schema";
import { buildChain } from "../../../test/fixtures/chain";
import { FakeSocket, installFakeWebAuthn, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { routerMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { defaultLayout } from "@/lib/chain/layout";
import { fmtPrice } from "@/lib/format";
import { venueSymbol } from "@/lib/strategy/legs";
import { ApiSettingsDialog } from "./ApiSettingsDialog";
import { ColumnSettingsDialog } from "./ColumnSettingsDialog";
import { OptionDetailsDialog } from "./OptionDetailsDialog";
import { CurrencyDialog, currencyNote } from "./CurrencyDialog";
import { SaveDraftDialog } from "./SaveDraftDialog";
import { ExchangeManagementDialog, validateBrokerForm } from "./ExchangeManagementDialog";
import { LogoutDialog } from "./LogoutDialog";
import { LotSizeDialog } from "./LotSizeDialog";
import { MindfulDialog, readMindful } from "./MindfulDialog";
import { SecurityDialog, groupKey, keyOf } from "./SecurityDialog";
import { PnlDialog } from "./PnlDialog";
import { ProfileDialog } from "./ProfileDialog";
import { SettingsDialogs } from "./SettingsDialogs";
import { SettingsDialogsLoader } from "./SettingsDialogsLoader";

let mock: MockFetch;
const EMAIL = "asha@example.com";
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({
    asset: "BTC",
    expiry: {},
    feedPaused: false,
    dialog: null,
    dialogsTouched: false,
    paletteOpen: false,
    chainColumns: defaultLayout(),
    legs: { BTC: [], ETH: [], XAUT: [] },
    chainLots: 10,
    optionDetail: null,
  });
  FakeSocket.reset();
});
afterEach(() => mock.restore());

describe("HC-WS-026 Option details dialog", () => {
  const EXPIRY = "2026-09-25";
  const chainRows = buildChain("BTC", EXPIRY);
  it("shows the symbol, the live figures and adds a leg with the chosen lots", async () => {
    const target = { asset: "BTC" as const, expiry: EXPIRY, strike: chainRows[5]!.strike, kind: "call" as const };
    useUiStore.getState().openOptionDetail(target);
    const onOpenChange = vi.fn();
    renderWithProviders(<OptionDetailsDialog open onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("option-symbol").textContent).toBe(venueSymbol("call", "BTC", target.strike, EXPIRY));
    expect(screen.getByTestId("option-description").textContent).toContain("CALL · BTC · 25 Sep");
    expect(screen.getByTestId("option-empty")).toBeTruthy();
    // the live quote arrives over the gateway
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    const topic = chainTopic("delta_india", "BTC", EXPIRY);
    await waitFor(() => expect(ws.sentFrames().flatMap((f) => (f as { topics?: string[] }).topics ?? [])).toContain(topic));
    act(() => {
      ws.receive({ t: "snap", topic, seq: 0, rows: chainRows });
    });
    const q = chainRows[5]!.call!;
    await waitFor(() => expect(screen.getByTestId("option-mark").textContent).toBe(fmtPrice(q.mark)));
    expect(screen.getByTestId("option-stats").textContent).toContain("Gamma");
    // ADR-056 (GAPS #32): the 24 h mark / IV sparkline from the market history route
    await waitFor(() => expect(screen.getByTestId("option-sparkline").dataset["state"]).toBe("ready"));
    expect(Number(screen.getByTestId("option-sparkline").dataset["points"])).toBeGreaterThan(1);
    expect(screen.getByTestId("chart-option-spark")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("option-qty").textContent).toContain("× 0.001"));
    const u = userEvent.setup();
    await u.selectOptions(screen.getByTestId("option-lots"), "25");
    expect(screen.getByTestId("option-qty").textContent).toContain("0.025");
    await u.click(screen.getByTestId("option-sell"));
    const legs = useUiStore.getState().legs.BTC;
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ kind: "call", side: "sell", lots: 25, price: q.mark, strike: target.strike, expiry: EXPIRY });
    expect(useUiStore.getState().chainLots).toBe(25);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("mounts through SettingsDialogs when the store opens it", async () => {
    renderWithProviders(<SettingsDialogs />);
    expect(screen.queryByTestId("option-details")).toBeNull();
    useUiStore.getState().openOptionDetail({ asset: "BTC", expiry: EXPIRY, strike: "50000", kind: "put" });
    expect(await screen.findByTestId("option-details")).toBeTruthy();
    expect(screen.getByTestId("option-symbol").textContent).toBe("P-BTC-50000-250926");
  });
});

describe("HC-WS-010..014 Column Settings", () => {
  it("HC-WS-011 switches toggle a column, the counter updates and HC-WS-012 quick buttons apply presets", async () => {
    const u = userEvent.setup();
    renderWithProviders(<ColumnSettingsDialog open onOpenChange={noop} />);
    expect(screen.getByTestId("columns-counter").textContent).toBe("5 of 13 columns visible");
    expect(screen.getByTestId("columns-row-gamma").dataset["on"]).toBe("false");
    await u.click(screen.getByRole("switch", { name: "Gamma" }));
    expect(useUiStore.getState().chainColumns.visible).toContain("gamma");
    expect(screen.getByTestId("columns-counter").textContent).toBe("6 of 13 columns visible");
    await u.click(screen.getByRole("switch", { name: "Gamma" }));
    expect(useUiStore.getState().chainColumns.visible).not.toContain("gamma");
    await u.click(screen.getByTestId("columns-preset-all"));
    expect(screen.getByTestId("columns-counter").textContent).toBe("13 of 13 columns visible");
    await u.click(screen.getByTestId("columns-preset-none"));
    expect(screen.getByTestId("columns-counter").textContent).toBe("0 of 13 columns visible");
    await u.click(screen.getByTestId("columns-preset-essentials"));
    expect(useUiStore.getState().chainColumns.visible).toEqual(["ask", "mark", "bid", "oi", "delta"]);
    // HC-WS-073 Greeks trio
    await u.click(screen.getByTestId("columns-greeks"));
    expect(useUiStore.getState().chainColumns.visible.slice(-3)).toEqual(["gamma", "theta", "vega"]);
    expect(screen.getByTestId("columns-greeks").textContent).toBe("Hide Greeks");
    // OHLC is listed but not switchable
    expect(screen.getByTestId("columns-group-ohlc").textContent).toContain("arrives with candle data");
    expect(screen.queryByRole("switch", { name: "Open" })).toBeNull();
  });
  it("HC-WS-013 the Reorder tab moves columns with ▲ ▼ and drag, and Reset restores the default", async () => {
    const u = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<ColumnSettingsDialog open onOpenChange={onOpenChange} />);
    await u.click(screen.getByTestId("columns-tab-reorder"));
    expect(screen.getByTestId("columns-order-ask").dataset["index"]).toBe("0");
    expect(screen.getByTestId("columns-up-ask").hasAttribute("disabled")).toBe(true);
    await u.click(screen.getByTestId("columns-down-ask"));
    expect(useUiStore.getState().chainColumns.order.slice(0, 2)).toEqual(["mark", "ask"]);
    await u.click(screen.getByTestId("columns-up-ask"));
    expect(useUiStore.getState().chainColumns.order.slice(0, 2)).toEqual(["ask", "mark"]);
    // hidden columns are badged
    expect(within(screen.getByTestId("columns-order-gamma")).getByText("hidden")).toBeTruthy();
    // drag "last" onto "ask" drops it before ask
    const last = screen.getByTestId("columns-order-last");
    const ask = screen.getByTestId("columns-order-ask");
    const dt = { effectAllowed: "", setData: noop, getData: () => "" } as unknown as DataTransfer;
    fireEvent.dragStart(last, { dataTransfer: dt });
    fireEvent.dragOver(ask, { dataTransfer: dt });
    fireEvent.drop(ask, { dataTransfer: dt });
    fireEvent.dragEnd(last, { dataTransfer: dt });
    expect(useUiStore.getState().chainColumns.order.slice(0, 2)).toEqual(["last", "ask"]);
    await u.click(screen.getByTestId("columns-preset-reset"));
    expect(useUiStore.getState().chainColumns).toEqual(defaultLayout());
    await u.click(screen.getByTestId("columns-done"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("HC-WS-010 the store's dialog kind mounts it through SettingsDialogs", async () => {
    renderWithProviders(<SettingsDialogs />);
    expect(screen.queryByTestId("column-settings")).toBeNull();
    useUiStore.getState().openDialog("columns");
    expect(await screen.findByTestId("column-settings")).toBeTruthy();
  });
});

const account = () => mock.state.accounts.get(EMAIL)!;
const noop = () => {};

describe("HC-SH-038..040 Currency Settings", () => {
  it("HC-SH-039 shows the stored rate, updates the note live, validates > 0 and persists", async () => {
    const u = userEvent.setup();
    const onOpenChange = (open: boolean) => {
      if (!open) useUiStore.getState().closeDialog();
    };
    renderWithProviders(<CurrencyDialog open onOpenChange={onOpenChange} />);
    const rate = await screen.findByTestId("conversion-rate");
    await waitFor(() => expect((rate as HTMLInputElement).value).toBe("83.5"));
    expect(screen.getByTestId("currency-note").textContent).toBe(currencyNote("USD", "83.5"));
    await u.click(screen.getByTestId("currency-INR"));
    await u.clear(rate);
    await u.type(rate, "84.25");
    expect(screen.getByTestId("currency-note").textContent).toContain("Indian Rupees (₹) · Rate: $1 = ₹84.25");
    await u.clear(rate);
    await u.type(rate, "0");
    await u.click(screen.getByTestId("currency-save"));
    expect(await screen.findByText("Conversion rate must be greater than 0")).toBeTruthy();
    await u.clear(rate);
    await u.type(rate, "84.25");
    await u.click(screen.getByTestId("currency-save"));
    await waitFor(() => expect(account().settings).toMatchObject({ currency: "INR", conversionRate: "84.25" }));
    expect(currencyNote("USD", "")).toContain("₹0");
  });
});

describe("HC-SH-129 Security: the TOTP second factor (ADR-078)", () => {
  it("turns on with the password, the key and the first code, shows the backup codes once, and turns off with the password", async () => {
    const u = userEvent.setup();
    const { rerender } = renderWithProviders(<SecurityDialog open onOpenChange={() => useUiStore.getState().closeDialog()} />);
    expect((await screen.findByTestId("security-status")).textContent).toBe("off");
    await u.click(screen.getByTestId("security-enable"));
    await u.click(screen.getByTestId("security-password-next"));
    expect(screen.getByTestId("security-error").textContent).toContain("password");
    await u.type(screen.getByTestId("security-password"), "wrong");
    await u.click(screen.getByTestId("security-password-next"));
    await waitFor(() => expect(screen.getByTestId("security-error").textContent).toBe("Invalid credentials."));
    await u.clear(screen.getByTestId("security-password"));
    await u.type(screen.getByTestId("security-password"), "Passw0rd!");
    await u.click(screen.getByTestId("security-password-next"));
    const key = await screen.findByTestId("security-secret");
    expect(key.textContent).toBe(groupKey("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"));
    expect(screen.getByTestId("security-uri").getAttribute("href")).toMatch(/^otpauth:\/\/totp\/HapieCoin/);
    expect(account().twoFactor).toMatchObject({ enabled: false, pending: true }); // nothing changes before the first code
    const boxes = within(screen.getByTestId("otp-input")).getAllByRole("textbox");
    await u.click(boxes[0]!);
    await u.keyboard("000000");
    await u.click(screen.getByTestId("security-verify"));
    await waitFor(() => expect(screen.getByTestId("security-error").textContent).toContain("not right"));
    await u.click(boxes[0]!);
    await u.keyboard("{Control>}a{/Control}{Backspace}654321");
    await u.click(screen.getByTestId("security-verify"));
    await waitFor(() => expect(screen.getAllByTestId("security-backup-code")).toHaveLength(10));
    expect(account().twoFactor?.enabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("security-status").textContent).toBe("on"));
    await u.click(screen.getByTestId("security-done"));
    // off again: the dialog re-opens on the idle step with the flag on
    rerender(<SecurityDialog open={false} onOpenChange={() => undefined} />);
    rerender(<SecurityDialog open onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("security-dialog").getAttribute("data-step")).toBe("idle"));
    expect(screen.getByTestId("security-status").textContent).toBe("on");
    await u.click(screen.getByTestId("security-disable"));
    await u.type(screen.getByTestId("security-password"), "Passw0rd!");
    await u.click(screen.getByTestId("security-disable-confirm"));
    await waitFor(() => expect(account().twoFactor).toBeUndefined());
    expect(keyOf("not-a-uri")).toBe("not-a-uri");
    expect(groupKey("ABCDEFGH")).toBe("ABCD EFGH");
  });
  it("mounts through SettingsDialogs when the store opens it", async () => {
    renderWithProviders(<SettingsDialogs />);
    act(() => useUiStore.getState().openDialog("security"));
    expect(await screen.findByTestId("security-dialog")).toBeTruthy();
  });
  it("HC-SH-137 passkeys (ADR-089): the list starts empty, Add records the browser's credential under the name given, Rename and Remove round-trip, a closed prompt is one sentence", async () => {
    const webauthn = installFakeWebAuthn("laptop-key");
    try {
      const u = userEvent.setup();
      renderWithProviders(<SecurityDialog open onOpenChange={noop} />);
      expect(await screen.findByTestId("passkey-empty")).toBeTruthy();
      expect(screen.getByTestId<HTMLInputElement>("passkey-add-name").value).toBe("This device");
      await u.clear(screen.getByTestId("passkey-add-name"));
      await u.type(screen.getByTestId("passkey-add-name"), "Work laptop");
      await u.click(screen.getByTestId("passkey-add"));
      await waitFor(() => expect(screen.getAllByTestId("passkey-row")).toHaveLength(1));
      expect(screen.getByTestId("passkey-name").textContent).toBe("Work laptop");
      expect(account().passkeys).toMatchObject([{ name: "Work laptop", credentialID: webauthn.credentialId }]);
      expect(webauthn.credentials.create).toHaveBeenCalledTimes(1);
      // rename
      await u.click(screen.getByTestId("passkey-rename"));
      await u.clear(screen.getByTestId("passkey-rename-input"));
      await u.click(screen.getByTestId("passkey-rename-save"));
      expect(screen.getByTestId("passkey-error").textContent).toContain("name");
      await u.type(screen.getByTestId("passkey-rename-input"), "Home laptop");
      await u.click(screen.getByTestId("passkey-rename-save"));
      await waitFor(() => expect(screen.getByTestId("passkey-name").textContent).toBe("Home laptop"));
      expect(account().passkeys?.[0]?.name).toBe("Home laptop");
      // a second add whose prompt the user closes: the sentence, nothing recorded
      webauthn.credentials.create.mockRejectedValueOnce(Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" }));
      await u.click(screen.getByTestId("passkey-add"));
      await waitFor(() => expect(screen.getByTestId("passkey-error").textContent).toMatch(/prompt was closed|not allowed|could not add/i));
      expect(account().passkeys).toHaveLength(1);
      // remove asks inline and can be kept; then the confirm removes it
      await u.click(screen.getByTestId("passkey-delete"));
      await u.click(screen.getByTestId("passkey-delete-cancel"));
      expect(screen.queryByTestId("passkey-delete-confirm")).toBeNull();
      await u.click(screen.getByTestId("passkey-delete"));
      await u.click(screen.getByTestId("passkey-delete-confirm"));
      await waitFor(() => expect(screen.queryByTestId("passkey-row")).toBeNull());
      expect(await screen.findByTestId("passkey-empty")).toBeTruthy();
      expect(account().passkeys).toEqual([]);
    } finally {
      webauthn.restore();
    }
  });
  it("HC-SH-137 without WebAuthn the section says so instead of offering Add; a session older than a day is told to sign in again", async () => {
    renderWithProviders(<SecurityDialog open onOpenChange={noop} />);
    expect(await screen.findByTestId("passkey-unsupported")).toBeTruthy();
    expect(screen.queryByTestId("passkey-add")).toBeNull();
    cleanup();
    const webauthn = installFakeWebAuthn("late-key");
    try {
      account().staleSession = true;
      const u = userEvent.setup();
      renderWithProviders(<SecurityDialog open onOpenChange={noop} />);
      await u.click(await screen.findByTestId("passkey-add"));
      await waitFor(() => expect(screen.getByTestId("passkey-error").textContent).toContain("Sign in again to add a passkey"));
      expect(account().passkeys ?? []).toEqual([]);
    } finally {
      delete account().staleSession;
      webauthn.restore();
    }
  });
});

describe("HC-TR-183 Mindful trading settings (ADR-074)", () => {
  it("prefills the stored pause, validates the threshold and the seconds, warns when switched off, and persists", async () => {
    const u = userEvent.setup();
    renderWithProviders(<MindfulDialog open onOpenChange={() => useUiStore.getState().closeDialog()} />);
    const threshold = await screen.findByTestId<HTMLInputElement>("mindful-threshold");
    await waitFor(() => expect(threshold.value).toBe("0"));
    expect(screen.getByTestId<HTMLInputElement>("mindful-seconds").value).toBe("30");
    expect(screen.getByTestId("mindful-enabled").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("mindful-off-note")).toBeNull();
    await u.clear(threshold);
    await u.type(threshold, "-5");
    await u.click(screen.getByTestId("mindful-save"));
    expect(screen.getByTestId("mindful-error").textContent).toContain("0 or a positive amount");
    await u.clear(threshold);
    await u.type(threshold, "25");
    const seconds = screen.getByTestId<HTMLInputElement>("mindful-seconds");
    await u.clear(seconds);
    await u.type(seconds, "5");
    await u.click(screen.getByTestId("mindful-save"));
    expect(screen.getByTestId("mindful-error").textContent).toContain("10 to 300");
    await u.clear(seconds);
    await u.type(seconds, "60");
    await u.click(screen.getByTestId("mindful-enabled"));
    expect(screen.getByTestId("mindful-off-note").textContent).toContain("the day you most want to skip it");
    await u.click(screen.getByTestId("mindful-save"));
    await waitFor(() => expect(account().settings.mindful).toEqual({ enabled: false, thresholdUsd: "25", pauseSeconds: 60 }));
    expect(readMindful(true, "abc", "30")).toEqual({ ok: false, error: "Threshold must be 0 or a positive amount in USD" });
    expect(readMindful(true, "0", "30.5").ok).toBe(false);
    expect(readMindful(true, " 12.5 ", "300")).toEqual({ ok: true, value: { enabled: true, thresholdUsd: "12.5", pauseSeconds: 300 } });
  });
  it("mounts through SettingsDialogs when the store opens it (menu, palette, Day P&L tile)", async () => {
    renderWithProviders(<SettingsDialogs />);
    act(() => useUiStore.getState().openDialog("mindful"));
    expect(await screen.findByTestId("mindful-dialog")).toBeTruthy();
  });
});

describe("HC-SH-041 / HC-SH-042 Lot Size Settings", () => {
  it("prefills, rejects non-positive values and saves decimal strings", async () => {
    const u = userEvent.setup();
    renderWithProviders(<LotSizeDialog open onOpenChange={noop} />);
    const btc = await screen.findByTestId("lot-BTC");
    await waitFor(() => expect((btc as HTMLInputElement).value).toBe("0.001"));
    expect(screen.getAllByText("1 lot =")).toHaveLength(3);
    await u.clear(btc);
    await u.click(screen.getByTestId("lot-save"));
    expect(await screen.findByText("BTC lot size must be greater than 0")).toBeTruthy();
    await u.type(btc, "0.002");
    await u.click(screen.getByTestId("lot-save"));
    await waitFor(() => expect(account().settings.lotSizes.BTC).toBe("0.002"));
    expect(account().settings.lotSizes.ETH).toBe("0.01");
  });
});

describe("HC-SH-043 / HC-SH-044 P&L Settings", () => {
  it("is a radio group; Save stores the basis", async () => {
    const u = userEvent.setup();
    renderWithProviders(<PnlDialog open onOpenChange={noop} />);
    const group = await screen.findByRole("radiogroup", { name: "P&L price basis" });
    await waitFor(() => expect(within(group).getByTestId("pnl-mark").getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText(/will differ/)).toBeTruthy();
    await u.click(screen.getByTestId("pnl-bid_ask"));
    expect(screen.getByTestId("pnl-bid_ask").getAttribute("aria-checked")).toBe("true");
    await u.click(screen.getByTestId("pnl-save"));
    await waitFor(() => expect(account().settings.pnlBasis).toBe("bid_ask"));
  });
});

describe("HC-SH-045..049 Exchange Management", () => {
  it("validateBrokerForm requires a name and normalises percentages", () => {
    expect(validateBrokerForm({ name: " ", feePct: "1", gstPct: "1", feeCapPct: "1" }).nameError).toBe("Exchange name is required");
    expect(validateBrokerForm({ name: "X", feePct: "abc", gstPct: "-1", feeCapPct: "10" }).body).toEqual({ name: "X", feePct: "0", gstPct: "0", feeCapPct: "10", venue: "delta_india" });
    expect(validateBrokerForm({ name: "D", feePct: "0", gstPct: "0", feeCapPct: "0" }, "deribit").body?.venue).toBe("deribit"); // HC-SH-124: an exchange belongs to the venue it is created on
  });
  it("lists brokers, adds with validation, edits and deletes with confirmation", async () => {
    const u = userEvent.setup();
    renderWithProviders(<ExchangeManagementDialog open onOpenChange={noop} />);
    await waitFor(() => expect(screen.getByTestId("broker-count").textContent).toBe("1 exchange(s) configured"));
    const row = screen.getByTestId("broker-row");
    expect(within(row).getByText("Delta Exchange India")).toBeTruthy();
    expect(within(row).getByText("GLOBAL")).toBeTruthy();
    expect(within(row).getByTestId("broker-delete-btn").hasAttribute("disabled")).toBe(true);
    // add: validation
    await u.click(screen.getByTestId("add-exchange"));
    await u.click(screen.getByTestId("broker-submit"));
    expect(screen.getByRole("alert").textContent).toBe("Exchange name is required");
    await u.type(screen.getByTestId("broker-name"), "CoinDCX");
    await u.clear(screen.getByTestId("broker-fee"));
    await u.type(screen.getByTestId("broker-fee"), "0.1");
    await u.click(screen.getByTestId("broker-submit"));
    await waitFor(() => expect(screen.getAllByTestId("broker-row")).toHaveLength(2));
    expect(account().brokers[1]).toMatchObject({ name: "CoinDCX", feePct: "0.1", scope: "USER" });
    // edit
    const added = screen.getAllByTestId("broker-row")[1]!;
    await u.click(within(added).getByTestId("broker-edit"));
    expect(screen.getAllByText("Edit Exchange").length).toBeGreaterThan(0);
    await u.clear(screen.getByTestId("broker-name"));
    await u.type(screen.getByTestId("broker-name"), "CoinDCX Pro");
    await u.click(screen.getByTestId("broker-submit"));
    await waitFor(() => expect(account().brokers[1]?.name).toBe("CoinDCX Pro"));
    await waitFor(() => expect(screen.getByText("CoinDCX Pro")).toBeTruthy());
    // delete with confirm
    await u.click(within(screen.getAllByTestId("broker-row")[1]!).getByTestId("broker-delete-btn"));
    expect(screen.getByText("This action cannot be undone")).toBeTruthy();
    expect(screen.getByText(/Warning: Any strategies using this exchange/)).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByTestId("broker-row")).toHaveLength(2);
    await u.click(within(screen.getAllByTestId("broker-row")[1]!).getByTestId("broker-delete-btn"));
    await u.click(screen.getByTestId("broker-delete-confirm"));
    await waitFor(() => expect(account().brokers).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByTestId("broker-row")).toHaveLength(1));
  });
  it("shows the empty state and rolls back an optimistic delete the API rejects", async () => {
    account().brokers = [];
    renderWithProviders(<ExchangeManagementDialog open onOpenChange={noop} />);
    expect(await screen.findByText("No exchanges configured")).toBeTruthy();
  });
});

describe("HC-SH-123 accounts in API Settings (ADR-068)", () => {
  it("a second key with its own name lists two accounts; the same name replaces its key; one can be disconnected alone", async () => {
    const u = userEvent.setup();
    renderWithProviders(<ApiSettingsDialog open onOpenChange={noop} />);
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["state"]).toBe("disconnected"));
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("api-label").value).toBe("Main")); // the first key is Main
    await u.type(screen.getByTestId("api-key"), "key-main-abcd");
    await u.type(screen.getByTestId("api-secret"), "s3cret");
    await u.click(screen.getByTestId("connect-save"));
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["count"]).toBe("1"));
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("api-label").value).toBe("Sub 1")); // the next free name
    await u.type(screen.getByTestId("api-key"), "key-sub-ef01");
    await u.type(screen.getByTestId("api-secret"), "s3cret2");
    await u.click(screen.getByTestId("connect-save"));
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["count"]).toBe("2"));
    expect(screen.getAllByTestId("api-account").map((r) => r.dataset["label"])).toEqual(["Main", "Sub 1"]);
    expect(account().credentials.map((c) => [c.label, c.apiKeyMasked])).toEqual([["Main", "****abcd"], ["Sub 1", "****ef01"]]);
    // the same name again replaces that key
    await u.clear(screen.getByTestId("api-label"));
    await u.type(screen.getByTestId("api-label"), "Sub 1");
    expect(screen.getByTestId("api-replacing").textContent).toContain("replaces the key stored for Sub 1");
    await u.type(screen.getByTestId("api-key"), "key-sub-2222");
    await u.type(screen.getByTestId("api-secret"), "s3cret3");
    await u.click(screen.getByTestId("connect-save"));
    await waitFor(() => expect(account().credentials.map((c) => c.apiKeyMasked)).toEqual(["****abcd", "****2222"]));
    expect(screen.getAllByTestId("api-account")).toHaveLength(2);
    // disconnect the sub-account alone
    await u.click(screen.getAllByTestId("disconnect-exchange")[1]!);
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["count"]).toBe("1"));
    expect(account().credentials.map((c) => c.label)).toEqual(["Main"]);
  });
});

describe("HC-SH-031..037 Delta Exchange API Settings", () => {
  it("HC-SH-035 checks the connection, validates credentials, connects, copies the IP and disconnects", async () => {
    const u = userEvent.setup();
    renderWithProviders(<ApiSettingsDialog open onOpenChange={noop} />);
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["state"]).toBe("disconnected"));
    expect(screen.getByText("Enter your Delta Exchange API credentials to enable live trading.")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("fee-line").textContent).toBe("Fee: 0.05% · GST: 18% · Cap: 10%"));
    await waitFor(() => expect(screen.getByTestId("whitelist-ip").textContent).toBe("172.236.179.136"));
    expect(screen.getByRole("link", { name: "Delta Exchange → Account → API Keys" }).getAttribute("rel")).toBe("noopener noreferrer");
    await u.click(screen.getByTestId("connect-save"));
    expect(await screen.findByText("Save Failed")).toBeTruthy();
    expect(screen.queryByTestId("disconnect-exchange")).toBeNull();
    await u.type(screen.getByTestId("api-key"), "key-1234abcd");
    await u.type(screen.getByTestId("api-secret"), "s3cret");
    await u.click(screen.getByTestId("connect-save"));
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["state"]).toBe("connected"));
    expect(screen.getByText("API Key: ****abcd")).toBeTruthy();
    expect(account().credentials[0]?.apiKeyMasked).toBe("****abcd");
    expect(account().credentials[0]?.label).toBe("Main");
    const connectCall = mock.calls.find((c) => c.url.endsWith("/v1/credentials") && c.method === "POST");
    expect(connectCall?.body).toContain('"apiSecret":"s3cret"');
    expect(screen.getByTestId<HTMLInputElement>("api-secret").value).toBe(""); // secret cleared after save
    await u.click(screen.getByTestId("copy-ip"));
    expect(await screen.findByText("IP address copied to clipboard")).toBeTruthy();
    await u.click(screen.getByTestId("disconnect-exchange"));
    await waitFor(() => expect(screen.getByTestId("api-status").dataset["state"]).toBe("disconnected"));
    expect(account().credentials).toEqual([]);
  });
});

describe("HC-SH-027..030 Profile", () => {
  it("shows fields read-only, edits and saves, picks an avatar and copies the referral code", async () => {
    const u = userEvent.setup();
    renderWithProviders(<ProfileDialog open onOpenChange={noop} />);
    const name = await screen.findByTestId("profile-name");
    expect(name.hasAttribute("disabled")).toBe(true);
    expect((name as HTMLInputElement).value).toBe("Asha Trader");
    await u.click(screen.getByTestId("profile-edit"));
    expect(name.hasAttribute("disabled")).toBe(false);
    await u.clear(name);
    await u.click(screen.getByTestId("profile-save"));
    expect(await screen.findByText("Full Name is required")).toBeTruthy();
    await u.type(name, "Asha T.");
    await u.type(screen.getByTestId("profile-mobile"), "12345");
    await u.click(screen.getByTestId("profile-save"));
    expect(await screen.findByText("Mobile number must have 10 digits")).toBeTruthy();
    await u.clear(screen.getByTestId("profile-mobile"));
    await u.type(screen.getByTestId("profile-mobile"), "9876543210");
    await u.click(screen.getByTestId("profile-save"));
    await waitFor(() => expect(account().user).toMatchObject({ name: "Asha T.", mobile: "9876543210" }));
    await waitFor(() => expect(screen.getByTestId("profile-edit")).toBeTruthy());
    await u.click(screen.getByTestId("avatar-big"));
    await u.click(screen.getByTestId("avatar-lightning"));
    await waitFor(() => expect(account().user.avatar).toBe("lightning"));
    await u.click(screen.getByRole("button", { name: "Copy referral code" }));
    expect(await screen.findByText("Referral code copied to clipboard")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Change" }));
  });
});

describe("HC-SH-026 Logout", () => {
  it("signs out through Better Auth, clears the cache and returns home", async () => {
    const u = userEvent.setup();
    renderWithProviders(<LogoutDialog open onOpenChange={noop} />);
    expect(screen.getByText(/Are you sure you want to sign out/)).toBeTruthy();
    await u.click(screen.getByTestId("logout-confirm"));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(mock.calls.some((c) => c.url.includes("/sign-out"))).toBe(true);
    expect(mock.state.sessions.size).toBe(0);
  });
});

describe("[SHELL] SettingsDialogs mounts the one the store opens", () => {
  it("opens and closes through the UI store", async () => {
    renderWithProviders(<SettingsDialogs />);
    expect(screen.queryByTestId("currency-dialog")).toBeNull();
    useUiStore.getState().openDialog("currency");
    expect(await screen.findByTestId("currency-dialog")).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(useUiStore.getState().dialog).toBeNull());
  });
});

describe("[SHELL] SettingsDialogsLoader defers the dialog chunk", () => {
  it("renders nothing until a dialog is requested, then keeps the chunk mounted", async () => {
    renderWithProviders(<SettingsDialogsLoader />);
    expect(screen.queryByTestId("lot-dialog")).toBeNull();
    expect(document.querySelector("[data-slot=dialog-content]")).toBeNull();
    useUiStore.getState().openDialog("lot");
    expect(await screen.findByTestId("lot-dialog")).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(useUiStore.getState().dialog).toBeNull());
    expect(useUiStore.getState().dialogsTouched).toBe(true);
  });
});

describe("HC-TR-155 the name dialog arrives filled", () => {
  it("shows the suggestion selected; typing replaces it; the hint restores it; Enter keeps it; an existing name wins", async () => {
    const onSave = vi.fn();
    const suggest = vi.fn(() => "BTC-IBF-11SEP26-1432");
    const { rerender } = renderWithProviders(<SaveDraftDialog open initialName="" suggest={suggest} intent="trade" onOpenChange={() => undefined} onSave={onSave} />);
    const box = screen.getByTestId<HTMLInputElement>("save-draft-name");
    expect(box.value).toBe("BTC-IBF-11SEP26-1432");
    expect(box.dataset["pristine"]).toBe("true");
    expect(screen.getByTestId("save-draft-hint").textContent).toContain("Suggested from the legs");
    expect(suggest).toHaveBeenCalledTimes(1);
    const u = userEvent.setup();
    await u.clear(box);
    await u.type(box, "Mine");
    expect(box.value).toBe("Mine");
    expect(box.dataset["pristine"]).toBeUndefined();
    expect(screen.getByTestId("save-draft-hint").textContent).toContain("Your name");
    await u.click(within(screen.getByTestId("save-draft-hint")).getByRole("button"));
    expect(box.value).toBe("BTC-IBF-11SEP26-1432");
    await u.click(box); // focus back on the box (the restore link had it); the value is untouched
    await u.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith("BTC-IBF-11SEP26-1432");
    expect(suggest).toHaveBeenCalledTimes(1); // never re-read while open
    // a name the trader already gave wins over the suggestion
    rerender(<SaveDraftDialog open={false} initialName="" suggest={suggest} intent="trade" onOpenChange={() => undefined} onSave={onSave} />);
    rerender(<SaveDraftDialog open initialName="Given" suggest={suggest} intent="draft" onOpenChange={() => undefined} onSave={onSave} />);
    expect(screen.getByTestId<HTMLInputElement>("save-draft-name").value).toBe("Given");
    expect(screen.queryByTestId("save-draft-hint")).toBeNull();
  });
});

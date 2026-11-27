// The trader's side of live Autopilot on the Autopilot screen (ADR-147, ADR-148, ADR-149; HC-TR-307..309), against the
// in-memory mock API: the mandate dialog, the mandate line under a strategy's row with its three steps, and live told
// apart from paper in the log and the summary. Nothing here places an order.
import { type AutopilotRun, MANDATE_REFUSALS, MANDATE_STATEMENT_KEYS, MANDATE_STATEMENTS, type Mandate, SavedDefinition, type SavedStrategy, savedEntryText, savedLossCapped } from "@hapiecoin/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { AutopilotPage } from "./AutopilotPage";
import { mandateBlock } from "./MandateDialog";
import { isIncompletePause, mandateView } from "./MandateLine";

const EMAIL = "autopilot-mandate@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL, { connected: true });
  acc().twoFactor = { enabled: true, pending: false, backupCodes: [] };
  mock.state.autopilotLive = true;
  useUiStore.setState({ workspaceTab: "paper", paneSource: null, adjust: null });
});
afterEach(() => mock.restore());

const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "pct" as const, value });
/** A strangle with wings: its loss is limited by the bought options, so it may trade live. */
const WINGED = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [leg("put", "buy", 3), leg("put", "sell", 1), leg("call", "sell", 1), leg("call", "buy", 3)], exits: { legStop: 2 } });
const FIGURES = { mean: 4.2, per: "day" as const, positivePct: 71, worst: -60, samples: 106, basis: "autopilot-study, real fees" };
const APPROVED = { by: null, byName: "The Owner", at: "2026-11-26T08:00:00.000Z" } as unknown as SavedStrategy["approval"];
function publish(id: string, over: Partial<SavedStrategy> = {}): SavedStrategy {
  const definition = over.definition ?? WINGED;
  const row: SavedStrategy = { id, familyId: id, version: 2, name: `Saved ${id}`, summary: "Sell both sides each evening, with wings.", definition, stage: "paper", audience: "plans", userIds: [], planIds: [acc().subscription!.planId], backtest: FIGURES, backtestAt: "2026-11-25T10:00:00.000Z", approval: APPROVED, traded: false, lossCapped: savedLossCapped(definition.legs), entryText: savedEntryText(definition), createdBy: null, createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", publishedAt: "2026-11-25T10:00:00.000Z", retiredAt: null, ...over };
  mock.state.savedStrategies.push(row);
  return row;
}
const held = (strategyId: string, over: Partial<Mandate> = {}): Mandate & { userId: string } => {
  const m = { id: `mnd_${mock.state.mandates.length + 1}`, userId: acc().user.id, strategyId, strategyName: "x", version: 2, accountId: "crd_main", accountLabel: "Main", lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, state: "active" as const, standing: true, signedAt: "2026-11-27T09:00:00.000Z", pausedAt: null, pauseReason: null, endedAt: null, endReason: null, ...over };
  mock.state.mandates.unshift(m);
  return m;
};
/** The trader has these strategies switched on (Autopilot enters nothing, live or paper, for one that is off). */
const switchOn = (...ids: string[]) => {
  acc().autopilot.settings = { enabled: true, strategies: ids.map((playbookId) => ({ playbookId, exit: "own" as const })) };
};
const cardOf = (id: string) => screen.getAllByTestId("autopilot-card").find((c) => c.dataset["playbook"] === id)!;
const ready = () => waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
const lineOf = async (id: string) => waitFor(() => within(cardOf(id)).getByTestId("mandate-line"));
// (the strategy rows sit in a tab panel that is not the one shown at first: the boxes are asked for whether shown or not)
const codeBoxes = (within_: HTMLElement) => within(within(within_).getByTestId("second-factor")).getAllByRole("textbox", { hidden: true });
const signCalls = () => mock.calls.filter((c) => c.method === "POST" && c.url.endsWith("/v1/autopilot/mandates"));

describe("HC-TR-307 the mandate dialog", () => {
  it("HC-TR-307 Trade live is offered only where a mandate could be signed and only while this server enters live trades", async () => {
    publish("sv_open", { name: "Winged evening" });
    publish("sv_pending", { name: "Not approved", approval: null });
    publish("sv_naked", { name: "Naked", definition: SavedDefinition.parse({ ...WINGED, legs: [leg("put", "sell", 1), leg("call", "sell", 1)] }) });
    const view = renderWithProviders(<AutopilotPage />);
    await ready();
    await waitFor(() => expect(within(cardOf("sv_open")).getByTestId("autopilot-trade-live")).toBeTruthy());
    expect(within(cardOf("sv_open")).getByTestId("trading-env").textContent).toBe("TESTNET");
    for (const id of ["sv_pending", "sv_naked"]) expect(within(cardOf(id)).queryByTestId("autopilot-trade-live")).toBeNull();
    // no built-in strategy can take a mandate
    expect(screen.getAllByTestId("autopilot-trade-live")).toHaveLength(1);
    expect(screen.queryByTestId("autopilot-live-strip")).toBeNull();
    view.unmount();
    // the server's switch is off: nothing offers live anywhere
    mock.state.autopilotLive = false;
    renderWithProviders(<AutopilotPage />);
    await ready();
    expect(screen.queryByTestId("autopilot-trade-live")).toBeNull();
  });

  it("HC-TR-307 without the authenticator, or without a connected exchange account, the dialog says what to do first and offers no form", async () => {
    publish("sv_open", { name: "Winged evening" });
    acc().twoFactor = { enabled: false, pending: false, backupCodes: [] };
    const view = renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    await u.click(await waitFor(() => within(cardOf("sv_open")).getByTestId("autopilot-trade-live")));
    await waitFor(() => expect(screen.getByTestId("mandate-no-authenticator").textContent).toContain("Switch the authenticator on for your account before signing a mandate"));
    expect(screen.queryByTestId("mandate-sign")).toBeNull();
    expect(screen.queryByTestId("mandate-lots")).toBeNull();
    view.unmount();
    acc().twoFactor = { enabled: true, pending: false, backupCodes: [] };
    acc().credentials = [];
    renderWithProviders(<AutopilotPage />);
    await ready();
    await u.click(await waitFor(() => within(cardOf("sv_open")).getByTestId("autopilot-trade-live")));
    await waitFor(() => expect(screen.getByTestId("mandate-no-account").textContent).toContain("Connect an account on the exchange this strategy trades on first"));
    expect(screen.queryByTestId("mandate-sign")).toBeNull();
  });

  it("HC-TR-307 the form says what is still missing, shows the four statements in the server's words, sends what was typed with the code, keeps no code after a refusal, and says that signing places nothing", async () => {
    const s = publish("sv_open", { name: "Winged evening" });
    switchOn("sv_open");
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    const offer = await waitFor(() => within(cardOf("sv_open")).getByTestId("autopilot-trade-live"));
    expect(offer.parentElement!.textContent).toContain("Until then it trades on paper.");
    await u.click(offer);
    const dialog = await screen.findByTestId("mandate-dialog");
    expect(dialog.textContent).toContain("Trade live · Winged evening v2");
    expect(within(dialog).getByTestId("trading-env").textContent).toBe("TESTNET");
    const note = () => screen.getByTestId("mandate-nothing-placed").textContent;
    const signBtn = () => screen.getByTestId<HTMLButtonElement>("mandate-sign");
    // the only account is chosen; the first thing missing is named, one at a time
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("mandate-account").value).toBe("crd_main"));
    expect(note()).toBe("Enter the lots per trade, a whole number.");
    expect(signBtn().disabled).toBe(true);
    await u.type(screen.getByTestId("mandate-lots"), "101");
    expect(note()).toBe("At most 100 lots per trade: the size this strategy runs at.");
    await u.clear(screen.getByTestId("mandate-lots"));
    await u.type(screen.getByTestId("mandate-lots"), "10");
    expect(note()).toBe("Enter the most capital it may use, in whole US dollars.");
    await u.type(screen.getByTestId("mandate-capital"), "500");
    expect(note()).toBe("Enter both loss limits, in whole US dollars.");
    await u.type(screen.getByTestId("mandate-day"), "50");
    await u.type(screen.getByTestId("mandate-week"), "40");
    expect(note()).toBe("The loss limit for the week is at least the limit for the day.");
    await u.clear(screen.getByTestId("mandate-week"));
    await u.type(screen.getByTestId("mandate-week"), "150");
    expect(note()).toBe("Tick each of the four statements.");
    expect(screen.getByTestId("mandate-limits-basis").textContent).toContain("closed trades only: the day from 00:00 UTC, the week from Monday 00:00 UTC");
    // the statements are the server's own sentences, each ticked by the reader
    const boxes = screen.getAllByTestId<HTMLInputElement>("mandate-statement");
    expect(boxes.map((b) => b.dataset["key"])).toEqual([...MANDATE_STATEMENT_KEYS]);
    expect(boxes.map((b) => b.closest("label")!.textContent)).toEqual(MANDATE_STATEMENT_KEYS.map((k) => MANDATE_STATEMENTS[k]));
    expect(boxes.every((b) => !b.checked)).toBe(true);
    for (const b of boxes) await u.click(b);
    expect(note()).toBe("Type LIVE to sign.");
    await u.type(screen.getByTestId("mandate-word"), "live");
    expect(note()).toBe("Enter the 6-digit code from your authenticator app.");
    // a wrong code: refused in the field's own place, nothing signed, and the code is not kept
    await u.type(codeBoxes(dialog)[0]!, "111111");
    expect(note()).toBe("Signing places no order. Autopilot enters when this strategy's conditions are met.");
    await u.click(signBtn());
    await waitFor(() => expect(screen.getByTestId("second-factor-error").textContent).toContain("not right"));
    expect(mock.state.mandates).toHaveLength(0);
    expect(codeBoxes(dialog).map((b) => (b as HTMLInputElement).value).join("")).toBe("");
    // the server's refusal is shown in its words: the approval was withdrawn while the form was open
    s.approval = null;
    await u.type(codeBoxes(dialog)[0]!, "654321");
    await u.click(signBtn());
    await waitFor(() => expect(screen.getByTestId("mandate-refusal").textContent).toBe(MANDATE_REFUSALS.notApproved));
    expect(mock.state.mandates).toHaveLength(0);
    s.approval = APPROVED;
    await u.type(codeBoxes(dialog)[0]!, "654321");
    await u.click(signBtn());
    await waitFor(() => expect(mock.state.mandates).toHaveLength(1));
    const sent = signCalls().at(-1)!;
    expect(sent.headers["x-second-factor"]).toBe("654321");
    expect(typeof sent.body === "string" ? JSON.parse(sent.body) : sent.body).toEqual({ strategyId: "sv_open", accountId: "crd_main", lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, statements: { realOrders: true, ownAccount: true, canLose: true, estimate: true }, confirm: "live" });
    // the dialog closes, and the row shows the mandate in place of the offer
    await waitFor(() => expect(screen.queryByTestId("mandate-dialog")).toBeNull());
    const line = await lineOf("sv_open");
    expect(within(line).getByTestId("mandate-state").textContent).toBe("LIVE · active");
    expect(within(cardOf("sv_open")).queryByTestId("autopilot-trade-live")).toBeNull();
  });

  it("HC-TR-307 what blocks a signing, in the order the form is read", () => {
    const ok = { accountId: "crd_main", lots: 10, maxLots: 100, maxOpen: 1, coins: 1, capital: 500, day: 50, week: 150, ticked: 4, word: " LIVE ", code: "654321" };
    expect(mandateBlock(ok)).toBeNull();
    expect(mandateBlock({ ...ok, accountId: "" })).toBe("Choose the exchange account it trades through.");
    expect(mandateBlock({ ...ok, maxOpen: 2 })).toBe("Trades open at once: 1 (one per coin).");
    expect(mandateBlock({ ...ok, maxOpen: 4, coins: 3 })).toBe("Trades open at once: 1 to 3 (one per coin).");
    expect(mandateBlock({ ...ok, maxOpen: null })).toContain("Trades open at once");
    expect(mandateBlock({ ...ok, day: 600, week: 700 })).toBe("The loss limit for the day is within the capital it may use.");
    expect(mandateBlock({ ...ok, week: 501 })).toBe("The loss limit for the week is within the capital it may use.");
    expect(mandateBlock({ ...ok, capital: 10_000_001 })).toBe("The most capital is at most 10,000,000 USD.");
    expect(mandateBlock({ ...ok, capital: 10_000_000, day: 50, week: 150 })).toBeNull();
    expect(mandateBlock({ ...ok, ticked: 3 })).toBe("Tick each of the four statements.");
    expect(mandateBlock({ ...ok, word: "yes" })).toBe("Type LIVE to sign.");
    expect(mandateBlock({ ...ok, code: "65432" })).toBe("Enter the 6-digit code from your authenticator app.");
  });
});

describe("HC-TR-308 the mandate under a strategy's row", () => {
  it("HC-TR-308 a mandate shows its terms; Pause is one click, Resume asks for the code, End asks once more; an ended one moves under Past mandates and the offer returns", async () => {
    publish("sv_open", { name: "Winged evening" });
    switchOn("sv_open");
    const m = held("sv_open");
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    let line = await lineOf("sv_open");
    expect(line.dataset["view"]).toBe("live");
    expect(within(line).getByTestId("mandate-terms").textContent).toBe("Main · 10 lots a trade · 1 open at once · capital 500 USD · loss limit 50 USD a day, 150 USD a week");
    expect(within(line).getByTestId("trading-env").textContent).toBe("TESTNET");
    expect(line.textContent).toContain("Pausing or ending stops new live entries. Open trades keep their exits.");
    expect(within(line).queryByTestId("mandate-reason")).toBeNull();
    // pause: one click, no code
    await u.click(within(line).getByTestId("mandate-pause"));
    await waitFor(() => expect(m.state).toBe("paused"));
    line = await waitFor(() => { const l = within(cardOf("sv_open")).getByTestId("mandate-line"); expect(l.dataset["view"]).toBe("paused"); return l; });
    expect(within(line).getByTestId("mandate-state").textContent).toBe("PAUSED");
    expect(within(line).getByTestId("mandate-reason").textContent).toBe("Paused by you");
    expect(within(line).queryByTestId("mandate-todo")).toBeNull();
    expect(mock.calls.filter((c) => c.url.endsWith(`/${m.id}/pause`)).at(-1)!.headers["x-second-factor"]).toBeUndefined();
    // resume: the code is asked for; leaving it paused clears what was typed
    await u.click(within(line).getByTestId("mandate-resume"));
    expect(within(line).getByTestId<HTMLButtonElement>("mandate-resume-yes").disabled).toBe(true);
    await u.type(codeBoxes(line)[0]!, "111111");
    await u.click(within(line).getByTestId("mandate-resume-yes"));
    await waitFor(() => expect(within(line).getByTestId("second-factor-error").textContent).toContain("not right"));
    expect(m.state).toBe("paused");
    await u.click(within(line).getByTestId("mandate-keep"));
    expect(within(line).queryByTestId("mandate-resume-ask")).toBeNull();
    await u.click(within(line).getByTestId("mandate-resume"));
    expect(codeBoxes(line).map((b) => (b as HTMLInputElement).value).join("")).toBe("");
    await u.type(codeBoxes(line)[0]!, "654321");
    await u.click(within(line).getByTestId("mandate-resume-yes"));
    await waitFor(() => expect(m.state).toBe("active"));
    expect(mock.calls.filter((c) => c.url.endsWith(`/${m.id}/resume`)).at(-1)!.headers["x-second-factor"]).toBe("654321");
    // end: one more question, and it can be kept
    line = await waitFor(() => { const l = within(cardOf("sv_open")).getByTestId("mandate-line"); expect(l.dataset["view"]).toBe("live"); return l; });
    await u.click(within(line).getByTestId("mandate-end"));
    expect(within(line).getByTestId("mandate-end-ask").textContent).toContain("End this mandate? It cannot be resumed");
    await u.click(within(line).getByTestId("mandate-keep"));
    expect(m.state).toBe("active");
    await u.click(within(line).getByTestId("mandate-end"));
    await u.click(within(line).getByTestId("mandate-end-yes"));
    await waitFor(() => expect(m.state).toBe("ended"));
    // ended: it is the record of what was signed, under Past mandates, with no step left; a new one can be signed
    const past = await waitFor(() => within(cardOf("sv_open")).getByTestId("autopilot-card-past"));
    expect(past.textContent).toContain("Past mandates (1)");
    const old = within(past).getByTestId("mandate-line");
    expect(old.dataset["view"]).toBe("ended");
    expect(within(old).getByTestId("mandate-reason").textContent).toBe("Ended by you");
    for (const id of ["mandate-pause", "mandate-resume", "mandate-end"]) expect(within(old).queryByTestId(id)).toBeNull();
    expect(within(cardOf("sv_open")).getByTestId("autopilot-trade-live")).toBeTruthy();
  });

  it("HC-TR-308 a mandate paused for an entry that did not complete shows the reason whole and what to do, and its refusal to resume in the server's words; one that no longer stands, and one on a server with live off, say so", async () => {
    const REASON = "Live entry incomplete: C-BTC-85600-260926 did not fill (insufficient_margin); 1 of 4 legs filled before it. No order was retried and none was sent to close anything. 2 legs that were never sent to the exchange were taken off the trade. 2 legs stay on the trade: check what the exchange holds and square it off; this mandate is paused";
    publish("sv_stuck", { name: "Stuck" });
    const stuck = held("sv_stuck", { state: "paused", pausedAt: "2026-11-27T16:06:00.000Z", pauseReason: REASON });
    const gone = publish("sv_gone", { name: "Gone" });
    held("sv_gone");
    gone.approval = null; // withdrawn after it was signed
    const view = renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    const line = await lineOf("sv_stuck");
    expect(within(line).getByTestId("mandate-reason").textContent).toBe(REASON); // whole, never cut
    expect(within(line).getByTestId("mandate-todo").textContent).toBe("What to do: check what your exchange account holds for this trade, then square the trade off on the Live tab of the desk. While that trade is open this mandate cannot be resumed.");
    await u.click(within(line).getByTestId("mandate-resume"));
    await u.type(codeBoxes(line)[0]!, "654321");
    await u.click(within(line).getByTestId("mandate-resume-yes"));
    await waitFor(() => expect(within(line).getByTestId("mandate-step-refusal").textContent).toBe(MANDATE_REFUSALS.incompleteEntry));
    expect(stuck.state).toBe("paused");
    const lost = await lineOf("sv_gone");
    expect(lost.dataset["view"]).toBe("not-standing");
    expect(within(lost).getByTestId("mandate-state").textContent).toBe("NOT STANDING");
    expect(within(lost).getByTestId("mandate-reason").textContent).toBe("No new live entries: the strategy is no longer approved for live, or is no longer yours to use.");
    // the strip above the summary counts them by what they are, and names the ones that need the trader
    const strip = screen.getByTestId("autopilot-live-strip");
    expect(within(strip).getAllByTestId("autopilot-live-count").map((x) => [x.dataset["view"], x.textContent])).toEqual([["paused", "1 paused: x"], ["not-standing", "1 not standing: x"]]);
    // the rows are on the Strategies tab: the strip takes the trader there
    await u.click(within(strip).getByTestId("autopilot-live-show"));
    expect(screen.getAllByTestId("autopilot-panel").find((x) => x.dataset["value"] === "strategies")!.hidden).toBe(false);
    expect(within(strip).queryByTestId("autopilot-live-show")).toBeNull();
    expect(strip.textContent).toContain("A trade entered live is on the Live tab of the desk, not in the paper lists below.");
    view.unmount();
    // the server's switch is off: an active, standing mandate is "signed", not "live", and says the strategy is on paper
    gone.approval = APPROVED;
    mock.state.autopilotLive = false;
    renderWithProviders(<AutopilotPage />);
    await ready();
    const waiting = await lineOf("sv_gone");
    expect(waiting.dataset["view"]).toBe("waiting");
    expect(within(waiting).getByTestId("mandate-state").textContent).toBe("Mandate signed · live is off");
    // (the strategy is switched off as well: the sentence claims no paper trading for it)
    expect(within(waiting).getByTestId("mandate-reason").textContent).toBe("Live Autopilot is switched off on this server. This strategy is switched off too: nothing is entered for it.");
    expect(screen.getByTestId("autopilot-live-strip").textContent).toContain("Live Autopilot is switched off on this server: nothing is entered live.");
    expect(within(cardOf("sv_stuck")).queryByTestId("autopilot-trade-live")).toBeNull();
  });

  it("HC-TR-308 an active mandate for a strategy that is switched off does not read LIVE: nothing is entered for it; switched on with the server off it says the strategy is on paper", async () => {
    publish("sv_off", { name: "Switched off" });
    publish("sv_on", { name: "Switched on" });
    held("sv_off");
    held("sv_on");
    switchOn("sv_on");
    const view = renderWithProviders(<AutopilotPage />);
    await ready();
    const off = await lineOf("sv_off");
    expect(off.dataset["view"]).toBe("off");
    expect(within(off).getByTestId("mandate-state").textContent).toBe("Mandate signed · strategy is off");
    expect(within(off).getByTestId("mandate-reason").textContent).toBe("This strategy is switched off on Autopilot: nothing is entered for it, live or paper. Switch it on to let this mandate work.");
    expect((await lineOf("sv_on")).dataset["view"]).toBe("live");
    expect(within(screen.getByTestId("autopilot-live-strip")).getAllByTestId("autopilot-live-count").map((x) => x.textContent)).toEqual(["1 active", "1 signed, strategy is off"]);
    // LIVE is a plain bold chip: never the amber of the primary action, never the green of a profit
    const chip = within(await lineOf("sv_on")).getByTestId("mandate-state");
    expect(chip.className).toContain("bg-secondary");
    expect(chip.className).not.toMatch(/bg-primary|text-profit|bg-buy/);
    view.unmount();
    mock.state.autopilotLive = false;
    renderWithProviders(<AutopilotPage />);
    await ready();
    expect(within(await lineOf("sv_on")).getByTestId("mandate-reason").textContent).toBe("Live Autopilot is switched off on this server. This strategy trades on paper meanwhile.");
  });

  it("HC-TR-308 a mandate whose strategy has left the trader's list is still shown, by name, and can be stopped; a mandates read that fails is said and offers nothing", async () => {
    const s = publish("sv_left", { name: "Left the list" });
    const other = publish("sv_stays", { name: "Stays" });
    const m = held("sv_left", { strategyName: "Left the list" });
    s.planIds = ["plan_of_somebody_else"]; // taken out of its audience after the mandate was signed
    const view = renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    const strip = await screen.findByTestId("autopilot-live-strip");
    expect(screen.getAllByTestId("autopilot-card").some((c) => c.dataset["playbook"] === "sv_left")).toBe(false);
    const orphan = await waitFor(() => within(strip).getByTestId("mandate-line"));
    expect(within(orphan).getByTestId("mandate-strategy").textContent).toBe("Left the list · v2");
    expect(orphan.dataset["view"]).toBe("not-standing");
    await u.click(within(orphan).getByTestId("mandate-end"));
    await u.click(within(orphan).getByTestId("mandate-end-yes"));
    await waitFor(() => expect(m.state).toBe("ended"));
    await waitFor(() => expect(screen.queryByTestId("autopilot-live-strip")).toBeNull());
    view.unmount();
    // the read fails: no row offers "Trade live" as if there were no mandate, and the screen says it could not read them
    held(other.id);
    mock.state.mandatesDown = true;
    renderWithProviders(<AutopilotPage />);
    await ready();
    await waitFor(() => expect(screen.getByTestId("autopilot-mandates-error").textContent).toContain("could not be read just now"));
    expect(screen.queryByTestId("autopilot-trade-live")).toBeNull();
  });

  it("HC-TR-307 only the accounts on the strategy's exchange are offered, and with several the trader chooses", async () => {
    publish("sv_open", { name: "Winged evening" });
    acc().brokers.push({ ...acc().brokers[0]!, id: "brk_other", name: "Other exchange", venue: "deribit" });
    acc().credentials.push({ id: "crd_second", label: "Second", brokerId: "brk_delta", apiKeyMasked: "****cd34", connectedAt: "2026-09-08T10:00:00.000Z", whitelistedIp: "172.236.179.136" }, { id: "crd_other", label: "Elsewhere", brokerId: "brk_other", apiKeyMasked: "****ef56", connectedAt: "2026-09-08T10:00:00.000Z", whitelistedIp: "172.236.179.136" });
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    await u.click(await waitFor(() => within(cardOf("sv_open")).getByTestId("autopilot-trade-live")));
    const select = await screen.findByTestId<HTMLSelectElement>("mandate-account");
    expect([...select.options].map((o) => o.value)).toEqual(["", "crd_main", "crd_second"]);
    expect(select.value).toBe("");
    expect(screen.getByTestId("mandate-nothing-placed").textContent).toBe("Choose the exchange account it trades through.");
    await u.selectOptions(select, "crd_second");
    expect(screen.getByTestId("mandate-nothing-placed").textContent).toBe("Enter the lots per trade, a whole number.");
  });

  it("HC-TR-308 how a mandate reads, alone", () => {
    expect(mandateView({ state: "active", standing: true }, true, true)).toBe("live");
    // live is said only when a live entry can be taken: the server enters live trades AND the strategy is switched on
    expect(mandateView({ state: "active", standing: true }, true, false)).toBe("off");
    expect(mandateView({ state: "active", standing: true }, false, true)).toBe("waiting");
    expect(mandateView({ state: "active", standing: true }, false, false)).toBe("waiting");
    expect(mandateView({ state: "active", standing: false }, true, true)).toBe("not-standing");
    expect(mandateView({ state: "paused", standing: true }, true, true)).toBe("paused");
    expect(mandateView({ state: "ended", standing: false }, true, true)).toBe("ended");
    expect(isIncompletePause({ state: "paused", pauseReason: "Paused by you" })).toBe(false);
    expect(isIncompletePause({ state: "paused", pauseReason: null })).toBe(false);
    expect(isIncompletePause({ state: "active", pauseReason: "Live entry incomplete: x" })).toBe(false);
  });
});

describe("HC-TR-309 live told apart from paper", () => {
  it("HC-TR-309 every log line says PAPER or LIVE, a live one with the TESTNET tag; without a mandate nothing about live is shown", async () => {
    const s = publish("sv_open", { name: "Winged evening" });
    const run = (id: string, over: Partial<AutopilotRun>): AutopilotRun => ({ id, at: "2026-11-27T16:05:00Z", playbookId: s.id, venue: "delta_india", asset: "BTC", kind: "skipped", reason: "Outside its entry hours", strategyId: null, detail: {}, ...over });
    acc().autopilot.runs = [run("3", { kind: "entered", reason: "Its entry conditions were met on the latest prices", detail: { mode: "live", mandateId: "mnd_1" } }), run("2", { reason: "Live: the mandate's loss limit for the day (50 USD, counted from 00:00 UTC on closed trades) is reached", detail: { mode: "live", mandateId: "mnd_1" } }), run("1", {})];
    renderWithProviders(<AutopilotPage />);
    await ready();
    const rows = await waitFor(() => { const r = screen.getAllByTestId("autopilot-run"); expect(r).toHaveLength(3); return r; });
    expect(rows.map((r) => within(r).getByTestId("autopilot-run-mode").textContent)).toEqual(["LIVE", "LIVE", "PAPER"]);
    expect(within(rows[0]!).getByTestId("autopilot-run-mode").className).not.toMatch(/bg-primary|text-profit|bg-buy/);
    expect(rows.map((r) => within(r).queryByTestId("trading-env")?.textContent ?? null)).toEqual(["TESTNET", "TESTNET", null]);
    expect(rows[1]!.textContent).toContain("Live: the mandate's loss limit for the day");
    // no mandate held: no strip, and the paper summary is as it was
    expect(screen.queryByTestId("autopilot-live-strip")).toBeNull();
    expect(screen.getByTestId("autopilot-summary")).toBeTruthy();
  });
});

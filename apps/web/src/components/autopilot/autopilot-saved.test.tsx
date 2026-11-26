// Saved strategies on the trader's Autopilot screen (HC-TR-279; ADR-141, ADR-142), against the in-memory mock API: a
// strategy an admin published for this trader is listed beside the built-in ones and can be switched on; one for
// somebody else is not shown; one the trader can no longer use keeps its name in the log. Paper only.
import { AUTOPILOT_PLAYBOOKS } from "@hapiecoin/pricing";
import { type AutopilotRun, SavedDefinition, type SavedStrategy, type Strategy, savedEntryText, savedLossCapped } from "@hapiecoin/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { AutopilotPage } from "./AutopilotPage";

const EMAIL = "autopilot-saved@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ workspaceTab: "paper", paneSource: null, adjust: null });
});
afterEach(() => mock.restore());

const DAILY = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: { legStop: 2, takeProfitOfCredit: 0.5 } });
const FIGURES = { mean: 12.4, per: "day" as const, positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, real fees" };
function publish(id: string, over: Partial<SavedStrategy> = {}): SavedStrategy {
  const definition = over.definition ?? DAILY;
  const row: SavedStrategy = { id, familyId: id, version: 1, name: `Saved ${id}`, summary: "Sell a call and a put 2 % away each evening.", definition, stage: "paper", audience: "plans", userIds: [], planIds: [acc().subscription!.planId], backtest: FIGURES, backtestAt: "2026-11-25T10:00:00.000Z", approval: null, traded: false, lossCapped: savedLossCapped(definition.legs), entryText: savedEntryText(definition), createdBy: null, createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", publishedAt: "2026-11-25T10:00:00.000Z", retiredAt: null, ...over };
  mock.state.savedStrategies.push(row);
  return row;
}
const cardOf = (id: string) => screen.getAllByTestId("autopilot-card").find((c) => c.dataset["playbook"] === id);
const ready = () => waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
/** A closed paper trade Autopilot opened from a strategy: what makes a retired strategy still the trader's to read. */
const closedTrade = (playbookId: string, name: string): Strategy => ({ id: `strat_${playbookId}`, name: `${name} · Autopilot`, asset: "BTC", venue: "delta_india", status: "archived", tradingMode: "paper", templateName: name, brokerId: "brk_delta", legs: [], realizedPnl: "4.20", pnlHistory: [], notes: "", tags: ["autopilot"], orderBatchId: null, orders: [], adjustments: [], startedAt: "2026-11-24T16:05:00Z", closedAt: "2026-11-25T12:02:00Z", createdAt: "2026-11-24T16:05:00Z", updatedAt: "2026-11-25T12:02:00Z", autopilotPlaybookId: playbookId });
const run = (over: Partial<AutopilotRun>): AutopilotRun => ({ id: "1", at: "2026-11-25T10:00:00Z", playbookId: "sv_old", venue: "delta_india", asset: "BTC", kind: "skipped", reason: "Outside its entry hours (9:30 to 10:30 PM IST)", strategyId: null, detail: {}, ...over });

describe("HC-TR-279 saved strategies on the Autopilot screen", () => {
  it("HC-TR-279 a strategy published for the trader's plan is listed after the built-in ones, reads like them, and is switched on with its own exits", async () => {
    publish("sv_mine", { name: "BTC evening strangle, 2 % away" });
    publish("sv_weekly", { name: "Friday strangle", definition: SavedDefinition.parse({ ...DAILY, cadence: "weekly", weekdayUtc: 5, minDte: 6.5, maxDte: 7.5, exits: {} }), backtest: { ...FIGURES, mean: -3, per: "week" } });
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    const ids = screen.getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"]);
    expect(ids).toHaveLength(AUTOPILOT_PLAYBOOKS.length + 2);
    expect(ids.filter((x) => !x!.startsWith("sv_"))).toEqual(expect.arrayContaining(AUTOPILOT_PLAYBOOKS.map((p) => p.id)));
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`0 of ${AUTOPILOT_PLAYBOOKS.length + 2}`);
    // in the family of its cadence, after the built-in ones of that family
    const daily = screen.getAllByTestId("autopilot-group").find((g) => within(g).queryAllByTestId("autopilot-card").some((c) => c.dataset["playbook"] === "sv_mine"))!;
    expect(within(daily).getAllByTestId("autopilot-card").at(-1)!.dataset["playbook"]).toBe("sv_mine");
    const weekly = screen.getAllByTestId("autopilot-group").find((g) => within(g).queryAllByTestId("autopilot-card").some((c) => c.dataset["playbook"] === "sv_weekly"))!;
    expect(weekly).not.toBe(daily);

    const mine = cardOf("sv_mine")!;
    expect(mine.textContent).toContain("BTC evening strangle, 2 % away");
    expect(mine.textContent).toContain("Enters every day, 9:30 to 10:30 PM IST, on the next expiry");
    expect(mine.textContent).toContain("Sell a call and a put 2 % away each evening.");
    expect(within(mine).getByTestId("autopilot-card-own").textContent).toBe("Its own exits");
    expect(within(mine).getByTestId("autopilot-card-exit-words").textContent).toBe("How it gets out: Stop at 2x on each sold option, take 50 % of the premium");
    expect(within(mine).getByTestId("autopilot-card-how").textContent).toContain("Backtest only so far: $12.4 a day on 106 trades, 71 % of them positive, worst -$180 (USD, figures entered by hand).");
    // sold options with no stop and no bought options: nothing is said to cap the loss
    const naked = cardOf("sv_weekly")!;
    expect(within(naked).getByTestId("autopilot-card-exit-words").textContent).toBe("How it gets out: No stop and no wings: the loss is not limited, held to expiry");
    expect(within(naked).getByTestId("autopilot-card-how").textContent).toContain("No stop and no bought options: nothing limits the loss");
    expect(naked.textContent).not.toContain("wings cap the loss");
    expect(naked.textContent).toContain("Enters each Friday, 9:30 to 10:30 PM IST, on the weekly expiry");
    expect(within(mine).getByTestId("autopilot-card-tags").textContent).not.toBe("");
    // its figures are the ones entered for it, and say that they were entered by hand
    const back = within(mine).getByTestId("autopilot-card-backtest").textContent;
    expect(back).toContain("a day");
    expect(back).toContain("71% won");
    expect(within(mine).getByTestId("autopilot-card-basis").textContent).toBe("106 trades tested · figures entered by hand: autopilot-study, real fees");
    expect(within(cardOf("sv_weekly")!).getByTestId("autopilot-card-backtest").textContent).toContain("a week");

    await u.click(within(mine).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([{ playbookId: "sv_mine", exit: "own" }]));
    await waitFor(() => expect(cardOf("sv_mine")!.dataset["on"]).toBe("true"));
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`1 of ${AUTOPILOT_PLAYBOOKS.length + 2}`);
    await u.click(within(cardOf("sv_mine")!).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([]));
  });

  it("HC-TR-274 HC-TR-279 a strategy for another plan, for another user, or not published is not on the screen: the built-in list alone", async () => {
    publish("sv_other_plan", { planIds: ["pln_not_mine"] });
    publish("sv_other_user", { audience: "users", userIds: ["usr_somebody_else"] });
    publish("sv_admins", { audience: "admins", planIds: [] });
    publish("sv_draft", { stage: "backtested" });
    renderWithProviders(<AutopilotPage />);
    await ready();
    expect(screen.getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"])).toEqual(AUTOPILOT_PLAYBOOKS.map((p) => p.id));
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`0 of ${AUTOPILOT_PLAYBOOKS.length}`);
  });

  it("HC-TR-274 HC-TR-279 a strategy that names the trader is theirs; an admin sees every published one", async () => {
    publish("sv_named", { audience: "users", userIds: [acc().user.id], planIds: [] });
    publish("sv_admins", { audience: "admins", planIds: [] });
    const view = renderWithProviders(<AutopilotPage />);
    await ready();
    expect(screen.getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"]).filter((x) => x!.startsWith("sv_"))).toEqual(["sv_named"]);
    view.unmount();
    acc().user.role = "admin";
    renderWithProviders(<AutopilotPage />);
    await ready();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"]).filter((x) => x!.startsWith("sv_"))).toEqual(["sv_named", "sv_admins"]));
  });

  it("HC-TR-273 HC-TR-279 a retired strategy the trader has traded is no longer offered or counted as on, and is said to have stopped; its line in the log keeps its name; the next save lets go of it", async () => {
    publish("sv_old", { name: "Retired strangle", stage: "retired", retiredAt: "2026-11-25T11:00:00.000Z", traded: true });
    publish("sv_new", { name: "Its next version", version: 2, familyId: "sv_old" });
    acc().strategies.push(closedTrade("sv_old", "Retired strangle"));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "sv_old", exit: "own" }] }, runs: [run({})] };
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await ready();
    expect(cardOf("sv_old")).toBeUndefined();
    expect(cardOf("sv_new")).toBeTruthy();
    expect(screen.getByTestId("autopilot-run").textContent).toContain("Retired strangle · BTC");
    // the one in the settings is not on offer: not counted, and said
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`0 of ${AUTOPILOT_PLAYBOOKS.length + 1}`);
    expect(screen.getByTestId("autopilot-gone").textContent).toBe("1 strategy you had on is no longer offered and has stopped entering");
    await u.click(within(cardOf("sv_new")!).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([{ playbookId: "sv_new", exit: "own" }]));
  });

  it("HC-TR-279 a strategy that only sits in the trader's settings or log, and is not theirs, is not sent: its id shows, nothing of it is read, and two such are counted", async () => {
    publish("sv_secret", { name: "For somebody else", audience: "users", userIds: ["usr_somebody_else"], planIds: [] });
    publish("sv_secret2", { name: "For somebody else too", audience: "admins", planIds: [] });
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "sv_secret", exit: "own" }, { playbookId: "sv_secret2", exit: "own" }] }, runs: [run({ playbookId: "sv_secret", reason: "This strategy is not available to you" })] };
    renderWithProviders(<AutopilotPage />);
    await ready();
    expect(screen.getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"])).toEqual(AUTOPILOT_PLAYBOOKS.map((p) => p.id));
    expect(screen.getByTestId("autopilot-page").textContent).not.toContain("For somebody else");
    expect(screen.getByTestId("autopilot-run").textContent).toContain("sv_secret · BTC");
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`0 of ${AUTOPILOT_PLAYBOOKS.length}`);
    expect(screen.getByTestId("autopilot-gone").textContent).toBe("2 strategies you had on are no longer offered and have stopped entering");
  });

  it("HC-TR-284 a saved strategy with exits on the whole trade reads with them, in its tags, its line and its sentences, and never as held to expiry", async () => {
    const SPREAD = { ...DAILY, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, minDte: 14, maxDte: 400, legs: [{ kind: "call", side: "buy", by: "strikes", value: 0 }, { kind: "call", side: "sell", by: "strikes", value: 2 }] };
    publish("sv_spread", { name: "Call spread on the trend", definition: SavedDefinition.parse({ ...SPREAD, exits: { targetOfMax: 0.5, stopOfMax: 0.5, timeStopDte: 2 } }) });
    publish("sv_trail", { definition: SavedDefinition.parse({ ...SPREAD, exits: { targetOfMax: 0.25, takeTrailPct: 10, timeStopDte: 1 } }) });
    publish("sv_sold", { definition: SavedDefinition.parse({ ...DAILY, exits: { targetOfMax: 0.5 } }) });
    publish("sv_soldtime", { definition: SavedDefinition.parse({ ...DAILY, minDte: 3, maxDte: 8, exits: { targetOfMax: 0.5, timeStopDte: 1 } }) });
    publish("sv_legstop", { definition: SavedDefinition.parse({ ...SPREAD, exits: { legStop: 2, targetOfMax: 0.5, stopOfMax: 0.5 } }) });
    renderWithProviders(<AutopilotPage />);
    await ready();
    const words = (id: string) => within(cardOf(id)!).getByTestId("autopilot-card-exit-words").textContent;
    const how = (id: string) => within(cardOf(id)!).getByTestId("autopilot-card-how").textContent;
    const tags = (id: string) => [...within(cardOf(id)!).getByTestId("autopilot-card-tags").querySelectorAll("li")].map((li) => li.textContent);

    expect(cardOf("sv_spread")!.textContent).toContain("Enters every day, any time from 5:30 AM IST to 5:30 the next morning, on the first expiry at least 14 days out");
    expect(words("sv_spread")).toBe("How it gets out: Bought options limit the loss, target at 50 % of the most it can make, stop at 50 % of the most it can lose, out 2 days before expiry");
    expect(how("sv_spread")).toContain("The whole trade is closed once it is up by 50 % of the most it can make, after fees. It is closed at a loss of 50 % of the most it can lose, before fees. It is closed 2 days before expiry, whatever the profit. Until then the bought options limit the loss.");
    expect(how("sv_spread")).not.toContain("held to settlement");
    expect(tags("sv_spread")).toEqual(["No stop on a leg", "Loss limited", "Target 50 % of max profit", "Stop 50 % of max loss", "Out 2 days before expiry"]);

    expect(words("sv_trail")).toBe("How it gets out: Bought options limit the loss, trail from 25 % of the most it can make, out 1 day before expiry");
    expect(how("sv_trail")).toContain("Once the trade is up by 25 % of the most it can make, after fees, it is not closed: it is trailed, and closed when the profit gives back 10 % of its best. It is closed 1 day before expiry, whatever the profit.");
    expect(tags("sv_trail")).toEqual(["No stop", "Loss limited", "Trail from 25 % of max profit", "Out 1 day before expiry"]);

    // sold options alone with a target: nothing limits the loss, and it says so
    expect(words("sv_sold")).toBe("How it gets out: The loss is not limited, target at 50 % of the most it can make");
    expect(how("sv_sold")).toContain("The whole trade is closed once it is up by 50 % of the most it can make, after fees. Otherwise it is held to settlement, and nothing limits the loss.");
    expect(tags("sv_sold")).toEqual(["No stop", "Target 50 % of max profit"]);

    // sold options with an exit before expiry and no cover: said, and never "held to settlement"
    expect(how("sv_soldtime")).toContain("It is closed 1 day before expiry, whatever the profit. Until then nothing limits the loss.");
    expect(how("sv_soldtime")).not.toContain("held to settlement");
    expect(cardOf("sv_soldtime")!.textContent).toContain("on the first expiry at least 3 days out");

    // with a stop on its sold option the stop leads, as on every card
    expect(words("sv_legstop")).toBe("How it gets out: Stop at 2x on each sold option, target at 50 % of the most it can make, stop at 50 % of the most it can lose");
    expect(how("sv_legstop")).toContain("It is closed at a loss of 50 % of the most it can lose, before fees. Each sold option is bought back if its price reaches 2 times what it was sold for.");
    expect(tags("sv_legstop")).toEqual(["Stop 2x", "Loss limited", "Target 50 % of max profit", "Stop 50 % of max loss"]);
    for (const id of ["sv_spread", "sv_trail", "sv_sold", "sv_legstop"]) expect(cardOf(id)!.textContent, id).not.toContain("Held to expiry");
  });
});

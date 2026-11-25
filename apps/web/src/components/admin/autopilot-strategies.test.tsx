// Admin · Autopilot strategies against the mock API (HC-TR-277, HC-TR-278; ADR-141, ADR-142): the list with stages and
// the steps each strategy allows, and the editor from an empty form to a strategy on paper. Paper only.
import { type SavedStrategy, SavedDefinition, savedEntryText, savedLossCapped } from "@hapiecoin/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { AutopilotStrategiesAdmin, stepsOf } from "./AutopilotStrategiesAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

const DAILY = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: { legStop: 2 } });
const WINGS = SavedDefinition.parse({ ...DAILY, legs: [{ kind: "put", side: "buy", by: "pct", value: 4 }, ...DAILY.legs, { kind: "call", side: "buy", by: "pct", value: 4 }], exits: {} });
const FIGURES = { mean: 12.4, per: "day" as const, positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, real fees" };
let n = 0;
function saved(over: Partial<SavedStrategy> = {}): SavedStrategy {
  n += 1;
  const definition = over.definition ?? DAILY;
  const id = over.id ?? `sv_${n}`;
  const at = new Date(Date.UTC(2026, 10, 25, 10, n)).toISOString();
  const row: SavedStrategy = { id, familyId: id, version: 1, name: `Strategy ${n}`, summary: "Sell both sides each evening.", definition, stage: "draft", audience: "admins", userIds: [], planIds: [], backtest: null, backtestAt: null, traded: false, lossCapped: savedLossCapped(definition.legs), entryText: savedEntryText(definition), createdBy: null, createdAt: at, updatedAt: at, publishedAt: null, retiredAt: null, ...over };
  mock.state.savedStrategies.push(row);
  return row;
}
const rowOf = (name: string) => screen.getAllByTestId("saved-row").find((r) => r.dataset["name"] === name)!;
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
async function open() {
  mock.loginAs(ADMIN, { role: "admin" });
  const u = userEvent.setup();
  renderWithProviders(<AutopilotStrategiesAdmin />);
  await waitFor(() => expect(screen.getByTestId("admin-saved").dataset["state"]).toBe("ready"));
  return u;
}

describe("HC-TR-277 the list of saved strategies", () => {
  it("HC-TR-277 the steps a strategy allows follow its stage and whether it has traded", () => {
    const at = (stage: SavedStrategy["stage"], traded = false) => stepsOf({ stage, traded } as SavedStrategy);
    expect(at("draft")).toEqual({ edit: true, publish: true, retire: false, remove: true });
    expect(at("backtested")).toEqual({ edit: true, publish: true, retire: false, remove: true });
    expect(at("paper")).toEqual({ edit: true, publish: false, retire: true, remove: false });
    expect(at("retired", true)).toEqual({ edit: false, publish: false, retire: false, remove: false });
    expect(at("retired")).toEqual({ edit: false, publish: false, retire: false, remove: true });
  });

  it("HC-TR-277 shows each strategy's stage, entry, figures and audience, newest first; filters by stage and search; says paper only", async () => {
    const pro = mock.state.plans.find((p) => p.name === "Pro") ?? mock.state.plans[0]!;
    saved({ name: "Draft one" });
    saved({ name: "Tested wings", definition: WINGS, stage: "backtested", backtest: FIGURES, backtestAt: "2026-11-25T10:00:00.000Z", audience: "users", userIds: ["u1"] });
    saved({ name: "Paper strangle", stage: "paper", backtest: { ...FIGURES, mean: -3 }, audience: "plans", planIds: [pro.id], traded: true, version: 2 });
    saved({ name: "Old one", stage: "retired", traded: true, audience: "users", userIds: ["u1", "u2"] });
    saved({ name: "Flat", stage: "backtested", backtest: { ...FIGURES, mean: 0 }, audience: "plans", planIds: [] });
    const u = await open();
    expect(screen.getByTestId("saved-paper-only").textContent).toBe("PAPER ONLY");
    expect(screen.getAllByTestId("saved-row").map((r) => r.dataset["name"])).toEqual(["Flat", "Old one", "Paper strangle", "Tested wings", "Draft one"]);
    const paper = rowOf("Paper strangle");
    expect(within(paper).getByTestId("saved-stage").textContent).toBe("On paper");
    expect(within(paper).getByTestId("saved-version").textContent).toBe("· v2");
    expect(paper.textContent).toContain("every day, 21:30 to 22:30 IST, on the next expiry");
    expect(paper.textContent).toContain("BTC · 100 lots");
    expect(paper.textContent).toContain("Loss not limited · has traded");
    expect(within(paper).getByTestId("saved-backtest").textContent).toContain("−$3 a day");
    expect(within(paper).getByTestId("saved-who").textContent).toBe(pro.name);
    const wings = rowOf("Tested wings");
    expect(wings.textContent).toContain("Loss limited by bought options");
    expect(within(wings).getByTestId("saved-backtest").textContent).toContain("+$12.4 a day");
    expect(within(wings).getByTestId("saved-backtest").textContent).toContain("71 % won · worst −$180 · 106 trades");
    expect(within(wings).getByTestId("saved-backtest").textContent).toContain("entered by hand");
    expect(within(wings).getByTestId("saved-who").textContent).toBe("1 named user");
    expect(within(rowOf("Old one")).getByTestId("saved-who").textContent).toBe("2 named users");
    expect(within(rowOf("Draft one")).getByTestId("saved-who").textContent).toBe("Admins only");
    expect(within(rowOf("Draft one")).getByTestId("saved-backtest").textContent).toBe("No figures yet");
    expect(within(rowOf("Flat")).getByTestId("saved-who").textContent).toBe("No plan chosen");
    expect(within(rowOf("Flat")).getByTestId("saved-backtest").textContent).toContain("$0 a day");
    // only the steps the API would accept
    expect(within(paper).queryByTestId("saved-publish")).toBeNull();
    expect(within(paper).getByTestId("saved-retire")).toBeTruthy();
    expect(within(paper).queryByTestId("saved-delete")).toBeNull();
    expect(within(rowOf("Old one")).queryByTestId("saved-edit")).toBeNull();
    expect(within(rowOf("Draft one")).getByTestId("saved-delete")).toBeTruthy();
    // filters
    await u.selectOptions(screen.getByTestId("saved-stage-filter"), "backtested");
    expect(screen.getAllByTestId("saved-row")).toHaveLength(2);
    await u.click(screen.getByTestId("saved-clear"));
    await u.type(screen.getByTestId("saved-search"), "nothing like it");
    expect(screen.getByTestId("saved-empty-filtered")).toBeTruthy();
    await u.click(screen.getByText("Clear filters"));
    expect(screen.getAllByTestId("saved-row")).toHaveLength(5);
  });

  it("HC-TR-277 copies, publishes, retires and deletes, asking first; a refusal is said in the server's words", async () => {
    saved({ name: "Ready", stage: "backtested", backtest: FIGURES });
    saved({ name: "No figures" });
    const u = await open();
    await u.click(within(rowOf("Ready")).getByTestId("saved-copy"));
    await waitFor(() => expect(rowOf("Ready (copy)")).toBeTruthy());
    expect(rowOf("Ready (copy)").dataset["stage"]).toBe("draft");
    // publish asks, and can be called off
    await u.click(within(rowOf("Ready")).getByTestId("saved-publish"));
    expect(screen.getByTestId("saved-confirm").textContent).toContain("No real order is placed");
    await u.click(screen.getByText("Cancel"));
    expect(rowOf("Ready").dataset["stage"]).toBe("backtested");
    await u.click(within(rowOf("Ready")).getByTestId("saved-publish"));
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(rowOf("Ready").dataset["stage"]).toBe("paper"));
    // a draft with no figures is refused by the server, in its words
    await u.click(within(rowOf("No figures")).getByTestId("saved-publish"));
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(screen.getByText("Enter its backtest figures before publishing")).toBeTruthy());
    expect(rowOf("No figures").dataset["stage"]).toBe("draft");
    // retire, then delete what never traded
    await u.click(within(rowOf("Ready")).getByTestId("saved-retire"));
    expect(screen.getByTestId("saved-confirm").textContent).toContain("open trades keep their exits");
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(rowOf("Ready").dataset["stage"]).toBe("retired"));
    await u.click(within(rowOf("No figures")).getByTestId("saved-delete"));
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(screen.getAllByTestId("saved-row")).toHaveLength(2));
    // gone elsewhere meanwhile: the copy and the delete say so
    const copy = rowOf("Ready (copy)");
    mock.state.savedStrategies.length = 0;
    await u.click(within(copy).getByTestId("saved-copy"));
    await waitFor(() => expect(screen.getAllByText("Not done").length).toBeGreaterThan(1));
    await u.click(within(copy).getByTestId("saved-delete"));
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(screen.getAllByText("Not done").length).toBeGreaterThan(2));
  });

  it("HC-TR-277 shows the empty state and the error state", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const view = renderWithProviders(<AutopilotStrategiesAdmin />);
    await waitFor(() => expect(screen.getByTestId("saved-empty")).toBeTruthy());
    expect(screen.getByTestId("saved-empty").textContent).toContain("The built-in Autopilot strategies are unchanged");
    view.unmount();
    mock.restore();
    mock = installMockFetch(); // nobody signed in: 401, the error state
    renderWithProviders(<AutopilotStrategiesAdmin />);
    await waitFor(() => expect(screen.getByTestId("saved-load-error")).toBeTruthy());
    await userEvent.setup().click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("saved-load-error")).toBeTruthy());
  });
});

describe("HC-TR-278 the editor", () => {
  it("HC-TR-278 says what is missing, reads the entry back in words, and saves a draft with figures and a plan", async () => {
    const plan = mock.state.plans[0]!;
    const u = await open();
    await u.click(screen.getByText("+ New strategy", { selector: "[data-testid=saved-new]" }));
    const error = () => screen.getByTestId("saved-error").textContent;
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toBe("Give the strategy a name.");
    type("saved-name", "BTC evening strangle");
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toBe("Describe the strategy in a sentence.");
    type("saved-summary", "Sell a call and a put 2 % away each evening.");
    expect(screen.getByTestId("saved-reads").textContent).toContain("Enters every day, 21:30 to 22:30 IST, on the next expiry.");
    // settings that cannot be: said where the entry is read back, and on save
    type("saved-lots", "");
    expect(screen.getByTestId("saved-reads").textContent).toContain("Lots:");
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toMatch(/^Lots: /);
    type("saved-lots", "50");
    // half-typed figures
    type("saved-bt-mean", "12.4");
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toContain("Backtest figures:");
    type("saved-bt-positive", "71");
    type("saved-bt-worst", "-180");
    type("saved-bt-samples", "106");
    type("saved-bt-basis", "autopilot-study, real fees");
    // an audience needs somebody
    await u.click(screen.getByTestId("saved-audience-users"));
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toBe("Name at least one user, or choose another audience.");
    await waitFor(() => expect(screen.getAllByTestId("saved-user").length).toBeGreaterThan(0));
    expect(screen.getByTestId("saved-users").textContent).toContain("Nobody named yet");
    await u.click(screen.getAllByTestId("saved-user")[0]!);
    expect(screen.getByTestId("saved-users").textContent).toContain("1 named");
    // the chosen user stays in sight, by name, when the search no longer shows them, and can be removed there
    type("saved-users-search", "nobody-by-this-name");
    await waitFor(() => expect(screen.getByText("No users match")).toBeTruthy());
    expect(screen.getByTestId("saved-user-chip").textContent).toContain(ADMIN);
    await u.click(screen.getByTestId("saved-user-remove"));
    expect(screen.getByTestId("saved-users").textContent).toContain("0 named");
    type("saved-users-search", "");
    await waitFor(() => expect(screen.getAllByTestId("saved-user").length).toBeGreaterThan(0));
    await u.click(screen.getAllByTestId("saved-user")[0]!);
    await u.click(screen.getAllByTestId("saved-user")[0]!);
    expect(screen.getByTestId("saved-users").textContent).toContain("0 named");
    await u.click(screen.getByTestId("saved-audience-plans"));
    await u.click(screen.getByTestId("saved-save"));
    expect(error()).toBe("Choose at least one plan, or choose another audience.");
    await u.click(screen.getByTestId(`saved-plan-${plan.id}`));
    // exits
    type("saved-leg-stop", "2");
    type("saved-take", "50");
    await u.selectOptions(screen.getByTestId("saved-buyback-by"), "price");
    type("saved-buyback-value", "5");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    const made = mock.state.savedStrategies[0]!;
    expect(made).toMatchObject({ name: "BTC evening strangle", stage: "backtested", audience: "plans", planIds: [plan.id], backtest: { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, real fees" } });
    expect(made.definition).toMatchObject({ lots: 50, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, exits: { legStop: 2, takeProfitOfCredit: 0.5, legBuyBackAt: 5 } });
    expect(rowOf("BTC evening strangle").dataset["stage"]).toBe("backtested");
  });

  it("HC-TR-276 HC-TR-278 a weekly strategy on a trend, with wings, built from the controls", async () => {
    const u = await open();
    await u.click(screen.getByTestId("saved-new"));
    type("saved-name", "ETH Friday condor");
    type("saved-summary", "Sell 2 % away on Fridays when the trend is up, with wings.");
    await u.click(screen.getByTestId("saved-asset-BTC"));
    await u.click(screen.getByTestId("saved-asset-ETH"));
    await u.selectOptions(screen.getByTestId("saved-cadence"), "weekly");
    await u.selectOptions(screen.getByTestId("saved-weekday"), "5");
    await u.selectOptions(screen.getByTestId("saved-from"), "19"); // 00:30 IST on Friday is 19:00 UTC on Thursday: kept as Thursday, read back as Friday
    await u.selectOptions(screen.getByTestId("saved-to"), "20");
    type("saved-min-dte", "6.5");
    type("saved-max-dte", "7.5");
    await u.click(screen.getByTestId("saved-once"));
    await u.click(screen.getByTestId("saved-sma"));
    await u.selectOptions(screen.getByTestId("saved-sma-side"), "above");
    type("saved-sma-days", "20");
    await u.click(screen.getByTestId("saved-iv"));
    type("saved-iv-min", "40");
    type("saved-iv-max", "90");
    type("saved-iv-days", "120");
    await u.click(screen.getByTestId("saved-move"));
    type("saved-move-pct", "1.5");
    type("saved-move-hours", "12");
    await u.click(screen.getByTestId("saved-preset-wings"));
    expect(screen.getAllByTestId("saved-leg")).toHaveLength(4);
    await u.click(screen.getByTestId("saved-leg-add"));
    expect(screen.getAllByTestId("saved-leg")).toHaveLength(5);
    await u.click(screen.getAllByTestId("saved-leg-remove")[4]!);
    const first = screen.getAllByTestId("saved-leg")[0]!;
    await u.selectOptions(within(first).getByTestId("saved-leg-by"), "strikes");
    fireEvent.change(within(first).getByTestId("saved-leg-value"), { target: { value: "8" } });
    await u.selectOptions(within(first).getByTestId("saved-leg-side"), "sell");
    await u.selectOptions(within(first).getByTestId("saved-leg-side"), "buy");
    await u.selectOptions(within(first).getByTestId("saved-leg-kind"), "call");
    await u.selectOptions(within(first).getByTestId("saved-leg-kind"), "put");
    type("saved-trail-rest", "50");
    type("saved-leg-stop", "3");
    type("saved-take-trail", "5");
    type("saved-take", "90");
    type("saved-ladder", "25, 50");
    type("saved-lock-at", "50");
    type("saved-lock-floor", "20");
    await u.selectOptions(screen.getByTestId("saved-exit-hour"), "10");
    await u.selectOptions(screen.getByTestId("saved-bt-per"), "week");
    expect(screen.getByTestId("saved-reads").textContent).toContain("Enters each Friday, 00:30 to 01:30 IST, on the weekly expiry, when the price is above its 20-day average and volatility is in its set range.");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    const d = mock.state.savedStrategies[0]!.definition;
    expect(d).toMatchObject({ assets: ["ETH"], cadence: "weekly", weekdayUtc: 4, fromHourUtc: 19, toHourUtc: 20, oncePerExpiry: true, minDte: 6.5, maxDte: 7.5, conditions: { sma: { days: 20, side: "above" }, ivRank: { min: 40, max: 90, lookbackDays: 120 } }, moveSide: { hours: 12, pct: 1.5 } });
    expect(d.legs).toEqual([{ kind: "put", side: "buy", by: "strikes", value: 8 }, { kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "buy", by: "pct", value: 4 }]);
    expect(d.exits).toEqual({ legStop: 3, takeProfitOfCredit: 0.9, takeTrailPct: 5, trailRestPct: 50, ladder: [25, 50], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10 });
    expect(mock.state.savedStrategies[0]).toMatchObject({ stage: "draft", audience: "admins", backtest: null });
  });

  it("HC-TR-278 a daily strategy on chosen days, at any time of day; one leg cannot be removed", async () => {
    const u = await open();
    await u.click(screen.getByTestId("saved-new"));
    type("saved-name", "Any time put");
    type("saved-summary", "Sell a put on Mondays and Fridays.");
    await u.click(screen.getByTestId("saved-preset-put"));
    expect(screen.getByTestId<HTMLButtonElement>("saved-leg-remove").disabled).toBe(true);
    await u.click(screen.getByTestId("saved-preset-call"));
    await u.click(screen.getByTestId("saved-preset-strangle"));
    await u.click(screen.getByTestId("saved-day-1"));
    await u.click(screen.getByTestId("saved-day-5"));
    await u.click(screen.getByTestId("saved-day-3"));
    await u.click(screen.getByTestId("saved-day-3"));
    await u.click(screen.getByTestId("saved-anytime"));
    expect(screen.getByText(/Days \(each from 05:30 IST to 05:30 the next morning\)/)).toBeTruthy();
    await u.click(screen.getByTestId("saved-save"));
    expect(screen.getByTestId("saved-error").textContent).toContain("any time of day enters once per expiry");
    await u.click(screen.getByTestId("saved-once"));
    await u.selectOptions(screen.getByTestId("saved-buyback-by"), "share");
    type("saved-buyback-value", "20");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies[0]!.definition).toMatchObject({ fromHourUtc: 0, toHourUtc: 24, weekdays: [1, 5], oncePerExpiry: true, exits: { legBuyBackShare: 0.2 } });
  });

  it("HC-TR-272 HC-TR-278 editing: a name in place; new settings on one that has traded become the next version; on one that has not, the figures are cleared", async () => {
    const traded = saved({ name: "Has traded", stage: "paper", backtest: FIGURES, traded: true });
    const fresh = saved({ name: "Never traded", stage: "backtested", backtest: FIGURES });
    const u = await open();
    // the name alone: the same version, no note
    await u.click(within(rowOf("Has traded")).getByTestId("saved-edit"));
    expect(screen.getByText("Edit strategy · version 1")).toBeTruthy();
    expect(screen.queryByTestId("saved-version-note")).toBeNull();
    // nothing changed: nothing is sent
    const before = mock.calls.length;
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.calls.slice(before).filter((c) => c.method === "PATCH")).toHaveLength(0);
    await u.click(within(rowOf("Has traded")).getByTestId("saved-edit"));
    type("saved-name", "Has traded, renamed");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.find((x) => x.id === traded.id)).toMatchObject({ name: "Has traded, renamed", stage: "paper", version: 1 });
    // the name alone was sent: no settings, no figures, no audience
    expect(JSON.parse(mock.calls.filter((c) => c.method === "PATCH").at(-1)!.body!)).toEqual({ name: "Has traded, renamed" });
    // on paper its figures cannot be removed: said here, nothing sent, the name typed with it is not lost to a refusal
    await u.click(within(rowOf("Has traded, renamed")).getByTestId("saved-edit"));
    for (const id of ["saved-bt-mean", "saved-bt-positive", "saved-bt-worst", "saved-bt-samples", "saved-bt-basis"]) type(id, "");
    await u.click(screen.getByTestId("saved-save"));
    expect(screen.getByTestId("saved-error").textContent).toBe("It is on paper: its backtest figures cannot be removed. Retire it first.");
    expect(screen.getByTestId<HTMLButtonElement>("saved-cancel").disabled).toBe(false);
    await u.click(screen.getByTestId("saved-cancel"));
    // new settings on it: said before saving, then version 2 as a draft, version 1 as it was
    await u.click(within(rowOf("Has traded, renamed")).getByTestId("saved-edit"));
    type("saved-leg-stop", "3");
    expect(screen.getByTestId("saved-version-note").textContent).toContain("creates version 2 as a draft; version 1 keeps its record");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    await waitFor(() => expect(rowOf("Has traded, renamed")).toBeTruthy());
    const v2 = mock.state.savedStrategies.find((x) => x.familyId === traded.id && x.version === 2)!;
    expect(v2).toMatchObject({ stage: "draft", backtest: null, definition: { exits: { legStop: 3 } } });
    expect(mock.state.savedStrategies.find((x) => x.id === traded.id)).toMatchObject({ stage: "paper", definition: { exits: { legStop: 2 } } });
    // new settings on one that is on paper and never traded: it comes off paper, said before saving
    const onPaper = saved({ name: "Paper, never traded", stage: "paper", backtest: FIGURES, publishedAt: "2026-11-25T10:00:00.000Z" });
    await u.click(within(rowOf("Has traded, renamed")).getByTestId("saved-copy")); // a refetch, so the new row is listed
    await waitFor(() => expect(rowOf("Paper, never traded")).toBeTruthy());
    await u.click(within(rowOf("Paper, never traded")).getByTestId("saved-edit"));
    type("saved-leg-stop", "6");
    expect(screen.getByTestId("saved-off-paper-note").textContent).toContain("comes off paper and stops entering until you publish it again");
    expect(screen.queryByTestId("saved-cleared-note")).toBeNull();
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.find((x) => x.id === onPaper.id)).toMatchObject({ stage: "draft", backtest: null, publishedAt: null });
    // new settings on one that never traded: the same row, figures cleared, said before saving
    await u.click(within(rowOf("Never traded")).getByTestId("saved-edit"));
    type("saved-leg-stop", "4");
    expect(screen.getByTestId("saved-cleared-note").textContent).toContain("the old backtest figures are cleared");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.find((x) => x.id === fresh.id)).toMatchObject({ stage: "draft", backtest: null, version: 1, definition: { exits: { legStop: 4 } } });
    // new figures typed with new settings are kept
    await u.click(within(rowOf("Never traded")).getByTestId("saved-edit"));
    type("saved-leg-stop", "5");
    type("saved-bt-mean", "9");
    type("saved-bt-positive", "60");
    type("saved-bt-worst", "-90");
    type("saved-bt-samples", "40");
    type("saved-bt-basis", "rerun for the stop at 5");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.find((x) => x.id === fresh.id)).toMatchObject({ stage: "backtested", backtest: { mean: 9, samples: 40 }, definition: { exits: { legStop: 5 } } });
  });

  it("HC-TR-272 HC-TR-278 a row stored in another shape than the editor writes is not new settings: a change of name stays a change of name", async () => {
    // days out of order, as the API accepts them
    const odd = saved({ name: "Odd shape", stage: "paper", backtest: FIGURES, traded: true, definition: SavedDefinition.parse({ ...DAILY, weekdays: [5, 1] }) });
    const u = await open();
    await u.click(within(rowOf("Odd shape")).getByTestId("saved-edit"));
    expect(screen.queryByTestId("saved-version-note")).toBeNull();
    type("saved-name", "Odd shape, renamed");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.filter((x) => x.familyId === odd.id)).toHaveLength(1);
    expect(mock.state.savedStrategies.find((x) => x.id === odd.id)).toMatchObject({ name: "Odd shape, renamed", stage: "paper", version: 1 });
  });

  it("HC-TR-277 the plans a strategy is for read as a mark until the plans have loaded", async () => {
    saved({ name: "For a plan", audience: "plans", planIds: ["pln_unknown_here"] });
    await open();
    await waitFor(() => expect(within(rowOf("For a plan")).getByTestId("saved-who").textContent).toBe("pln_unknown_here"));
  });

  it("HC-TR-278 a refusal by the server stays in the editor, in its words; Cancel closes it", async () => {
    const row = saved({ name: "Soon retired", stage: "paper", backtest: FIGURES });
    const u = await open();
    await u.click(within(rowOf("Soon retired")).getByTestId("saved-edit"));
    mock.state.savedStrategies.find((x) => x.id === row.id)!.stage = "retired"; // retired elsewhere meanwhile
    type("saved-name", "Renamed too late");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.getByTestId("saved-error").textContent).toBe("A retired strategy cannot be changed: duplicate it"));
    await u.click(screen.getByTestId("saved-cancel"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    // a new strategy whose second step is refused is a draft already: saving again changes it, and makes no second one
    await u.click(screen.getByTestId("saved-new"));
    type("saved-name", "Two steps");
    type("saved-summary", "Its plan disappears between the two requests.");
    await u.click(screen.getByTestId("saved-audience-plans"));
    const plan = mock.state.plans[0]!;
    await u.click(screen.getByTestId(`saved-plan-${plan.id}`));
    const plans = mock.state.plans.splice(0, mock.state.plans.length);
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.getByTestId("saved-error").textContent).toBe(`Saved as a draft, but its figures and audience were not: No such plan: ${plan.id}`));
    mock.state.plans.push(...plans);
    type("saved-name", "Two steps, saved twice");
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.queryByTestId("saved-dialog")).toBeNull());
    expect(mock.state.savedStrategies.filter((x) => x.name.startsWith("Two steps"))).toHaveLength(1);
    expect(mock.state.savedStrategies.find((x) => x.name === "Two steps, saved twice")).toMatchObject({ stage: "draft", audience: "plans", planIds: [plan.id] });
    // a new strategy whose first save is refused says so as well
    await u.click(screen.getByTestId("saved-new"));
    type("saved-name", "Refused");
    type("saved-summary", "The session ended.");
    mock.restore();
    mock = installMockFetch(); // signed out: the create is refused
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(screen.getByTestId("saved-error").textContent).not.toBe(""));
  });
});

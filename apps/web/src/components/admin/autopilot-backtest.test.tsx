// Admin · the backtest of a saved strategy in the app, against the mock API (HC-TR-289, HC-TR-290; ADR-144): the run
// and what it shows, the refusals, and its figures put on the strategy with their source. Paper only.
import { type SavedBacktestRun, type SavedStrategy, SavedDefinition, savedEntryText, savedLossCapped } from "@hapiecoin/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { periodOf, signedUsd, totalsOf } from "./AutopilotBacktestDialog";
import { AutopilotStrategiesAdmin } from "./AutopilotStrategiesAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  // a run is done on the first read after it starts, unless a test wants to watch it run
  mock.state.savedBacktestReads = 0;
});
afterEach(() => mock.restore());

const DAILY = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: { legStop: 3 } });
let n = 0;
function saved(over: Partial<SavedStrategy> = {}): SavedStrategy {
  n += 1;
  const definition = over.definition ?? DAILY;
  const id = over.id ?? `bt_sv_${n}`;
  const at = new Date(Date.UTC(2026, 10, 25, 10, n)).toISOString();
  const row: SavedStrategy = { id, familyId: id, version: 1, name: `Strategy ${n}`, summary: "Sell both sides each evening.", definition, stage: "draft", audience: "admins", userIds: [], planIds: [], backtest: null, backtestAt: null, traded: false, lossCapped: savedLossCapped(definition.legs), entryText: savedEntryText(definition), createdBy: null, createdAt: at, updatedAt: at, publishedAt: null, retiredAt: null, ...over };
  mock.state.savedStrategies.push(row);
  return row;
}
/** A run put straight into the mock, as one that happened earlier. */
function ran(strategy: SavedStrategy, over: Partial<SavedBacktestRun> = {}, tested: SavedDefinition = strategy.definition): SavedBacktestRun {
  const run: SavedBacktestRun = { id: `run_${mock.state.savedBacktests.length + 1}`, strategyId: strategy.id, status: "done", progress: { done: 4, total: 4 }, from: "2026-08-07", to: "2026-11-20", resolution: "5m", figures: null, noEntry: {}, barsJudged: 100, barsSkipped: 0, notes: [], trades: [], error: null, current: true, createdAt: "2026-11-26T08:30:00.000Z", finishedAt: "2026-11-26T08:31:00.000Z", ...over };
  mock.state.savedBacktests.push({ run, tested: JSON.stringify(tested), reads: 0 });
  return run;
}
const rowOf = (name: string) => screen.getAllByTestId("saved-row").find((r) => r.dataset["name"] === name)!;
const dialog = () => screen.getByTestId("saved-backtest-dialog");
async function open(name?: string) {
  mock.loginAs(ADMIN, { role: "admin" });
  const u = userEvent.setup();
  renderWithProviders(<AutopilotStrategiesAdmin />);
  await waitFor(() => expect(screen.getByTestId("admin-saved").dataset["state"]).toBe("ready"));
  if (name) {
    await u.click(within(rowOf(name)).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(dialog().dataset["state"]).not.toBe("loading"));
  }
  return u;
}

describe("HC-TR-289 the backtest of a saved strategy in the app", () => {
  it("HC-TR-289 the figures of a run are money with a sign and two decimals, added up in whole cents, and say their period and prices", () => {
    expect(signedUsd(10.5)).toBe("+$10.50");
    expect(signedUsd(-1108.2)).toBe("−$1,108.20");
    expect(signedUsd(0)).toBe("$0.00");
    const t = (gross: number, fees: number) => ({ gross, fees, net: gross - fees }) as SavedBacktestRun["trades"][number];
    expect(totalsOf([t(0.1, 0.01), t(0.2, 0.02), t(-0.3, 0.03)])).toEqual({ gross: 0, fees: 0.06, net: -0.06 });
    // fees come finer than a cent and the results in whole cents: the fees shown are what lies between the two results
    expect(totalsOf([{ gross: 10, fees: 0.0051, net: 10 }, { gross: 5.01, fees: 0.0149, net: 4.99 }] as SavedBacktestRun["trades"])).toEqual({ gross: 15.01, fees: 0.02, net: 14.99 });
    expect(totalsOf([])).toEqual({ gross: 0, fees: 0, net: 0 });
    expect(periodOf({ from: "2026-08-07", to: "2026-11-20", resolution: "5m" })).toBe("07 Aug 2026 to 20 Nov 2026 · 5-minute prices");
    expect(periodOf({ from: "2025-11-28", to: "2026-11-13", resolution: "1h" })).toBe("28 Nov 2025 to 13 Nov 2026 · hourly prices");
  });

  it("HC-TR-289 runs from the list on the saved settings: progress while it runs, then the figures with period, fees, limits, days without an entry and the trades", async () => {
    mock.state.savedBacktestReads = 1;
    saved({ name: "Evening strangle" });
    saved({ name: "Retired one", stage: "retired" });
    const u = await open();
    // a retired strategy cannot take figures, so it offers no backtest
    expect(within(rowOf("Retired one")).queryByTestId("saved-backtest-open")).toBeNull();
    await u.click(within(rowOf("Evening strangle")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("none"));
    expect(dialog().textContent).toContain("Backtest · Evening strangle");
    expect(dialog().textContent).toContain("PAPER");
    expect(dialog().textContent).toContain("nothing is placed");
    expect(screen.getByTestId("saved-backtest-none").textContent).toBe("No backtest has been run on this strategy yet.");
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    expect(screen.getByTestId("saved-backtest-run").textContent).toBe("Run backtest");
    await u.click(screen.getByTestId("saved-backtest-run"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("running"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-running").textContent).toContain("Entry day 1 of 4"));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    // the period is written when the run finishes: until then only its prices are said
    expect(screen.getByTestId("saved-backtest-period").textContent).toMatch(/^Run of .* · 5-minute prices$/);
    expect(screen.getByTestId("saved-backtest-period").textContent).not.toContain(" to ");
    expect(screen.getByTestId("saved-backtest-run").hasAttribute("disabled")).toBe(true);
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    // asked again by itself until it is done
    await waitFor(() => expect(dialog().dataset["state"]).toBe("done"), { timeout: 6000 });
    expect(screen.getByTestId("saved-backtest-period").textContent).toContain("10 Nov 2026 to 13 Nov 2026 · 5-minute prices");
    expect(screen.getByTestId("saved-backtest-figures").textContent).toBe("+$6.50 a day66.7 % wonworst −$40.253 trades");
    expect(screen.getByTestId("saved-backtest-totals").textContent).toBe("Before fees +$27.75 · fees −$8.25 · after fees +$19.50 (USD, at this strategy's size)");
    const notes = screen.getByTestId("saved-backtest-notes");
    expect(notes.hasAttribute("open")).toBe(true);
    expect(notes.textContent).toContain("The limits of these figures (3)");
    expect(notes.querySelectorAll("li")).toHaveLength(3);
    expect(notes.textContent).toContain("Fills are at the mark price of the bar: no spread is counted.");
    expect(screen.getByTestId("saved-backtest-bars").textContent).toBe("Every one of its 720 price bars had a price for each open option.");
    expect(notes.textContent).toContain("A backtest is not a result");
    expect(screen.getByTestId("saved-backtest-no-entry").textContent).toContain("Entry days with no trade: 1");
    expect(screen.getByTestId("saved-backtest-no-entry").textContent).toContain("No expiry in its range on that day: 1");
    // the trades, newest first, each with its legs, how it ended and its result after fees
    const trades = screen.getAllByTestId("saved-backtest-trade");
    expect(trades).toHaveLength(3);
    expect(trades[0]!.textContent).toContain("12 Nov 2026");
    expect(trades[1]!.textContent).toContain("S 82,400P · S 85,600C");
    expect(trades[1]!.textContent).toContain("stopped");
    expect(trades[1]!.textContent).toContain("−$40.25");
    expect(trades[2]!.textContent).toContain("expired");
    expect(trades[2]!.textContent).toContain("+$30.50");
    expect(screen.getByTestId("saved-backtest-run").textContent).toBe("Run again");
    expect(screen.getByTestId("saved-backtest-use")).toBeTruthy();
    // closing leaves the strategy as it was: a run alone changes nothing on it
    await u.click(screen.getByTestId("saved-backtest-close"));
    expect(screen.queryByTestId("saved-backtest-dialog")).toBeNull();
    expect(within(rowOf("Evening strangle")).getByTestId("saved-stage").textContent).toBe("Draft");
    expect(mock.state.savedStrategies.find((s) => s.name === "Evening strangle")!.backtest).toBeNull();
  }, 15_000);

  it("HC-TR-289 sends the period asked for, refuses one that ends before it starts, and says the server's refusals in its words", async () => {
    saved({ name: "Ranked", definition: SavedDefinition.parse({ ...DAILY, conditions: { ivRank: { min: 20, max: 80, lookbackDays: 90 } } }) });
    const plain = saved({ name: "Plain" });
    const u = await open("Ranked");
    await u.click(screen.getByTestId("saved-backtest-run"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-refusal").textContent).toBe("It enters on a volatility rank, which the recorded history cannot judge far enough back. Enter its backtest figures by hand."));
    expect(mock.state.savedBacktests).toHaveLength(0);
    await u.click(screen.getByTestId("saved-backtest-close"));

    await u.click(within(rowOf("Plain")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("none"));
    fireEvent.change(screen.getByTestId("saved-backtest-from"), { target: { value: "2026-11-13" } });
    fireEvent.change(screen.getByTestId("saved-backtest-to"), { target: { value: "2026-11-10" } });
    await u.click(screen.getByTestId("saved-backtest-run"));
    expect(screen.getByTestId("saved-backtest-refusal").textContent).toBe("The period ends before it starts.");
    expect(mock.state.savedBacktests).toHaveLength(0);
    // no price history on this server
    mock.state.savedBacktestSource = false;
    fireEvent.change(screen.getByTestId("saved-backtest-from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByTestId("saved-backtest-to"), { target: { value: "2026-10-20" } });
    await u.click(screen.getByTestId("saved-backtest-run"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-refusal").textContent).toBe("The exchange's price history is not available on this server"));
    mock.state.savedBacktestSource = true;
    await u.click(screen.getByTestId("saved-backtest-run"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("done"));
    expect(screen.queryByTestId("saved-backtest-refusal")).toBeNull();
    expect(mock.state.savedBacktests[0]!.run).toMatchObject({ strategyId: plain.id, from: "2026-10-01", to: "2026-10-20" });
    expect(screen.getByTestId("saved-backtest-period").textContent).toContain("01 Oct 2026 to 20 Oct 2026");
  });

  it("HC-TR-289 a run that failed, one that made no trade and one on older settings offer no figures to use; earlier runs are listed", async () => {
    const failed = saved({ name: "Failed" });
    ran(failed, { status: "failed", error: "The backtest was interrupted: run it again", finishedAt: null, from: "2026-11-26", to: "2026-11-26" });
    const empty = saved({ name: "Empty" });
    ran(empty, { noEntry: { "Its conditions were not met": 9 }, notes: ["9 of 9 entry days made no trade."] });
    const stale = saved({ name: "Changed" });
    ran(stale, { figures: { mean: 4, per: "day", positivePct: 60, worst: -20, samples: 5, basis: "Backtest in the app" }, createdAt: "2026-11-25T08:30:00.000Z" }, SavedDefinition.parse({ ...DAILY, lots: 50 }));
    ran(stale, { figures: { mean: 9, per: "trade", positivePct: 70, worst: -30, samples: 8, basis: "Backtest in the app" }, resolution: "1h", barsJudged: 90, barsSkipped: 10, notes: ["10 of 100 bars had no price for an open leg and were not judged."] }, SavedDefinition.parse({ ...DAILY, lots: 50 }));
    const u = await open("Failed");
    expect(dialog().dataset["state"]).toBe("failed");
    expect(screen.getByTestId("saved-backtest-failed").textContent).toContain("The backtest was interrupted: run it again");
    // a run that did not finish never wrote its period: none is shown
    expect(screen.getByTestId("saved-backtest-period").textContent).not.toContain("26 Nov 2026 to");
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    await u.click(screen.getByTestId("saved-backtest-close"));

    await u.click(within(rowOf("Empty")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-empty").textContent).toBe("It made no trade in this period, so there are no figures to use."));
    expect(screen.getByTestId("saved-backtest-no-entry").textContent).toContain("Its conditions were not met: 9");
    expect(screen.queryByTestId("saved-backtest-figures")).toBeNull();
    expect(screen.queryByTestId("saved-backtest-trades")).toBeNull();
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    await u.click(screen.getByTestId("saved-backtest-close"));

    await u.click(within(rowOf("Changed")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-result").dataset["current"]).toBe("false"));
    expect(screen.getByTestId("saved-backtest-stale").textContent).toBe("The settings changed since this run: its figures cannot be used. Run it again.");
    expect(screen.getByTestId("saved-backtest-figures").textContent).toContain("+$9.00 a trade");
    expect(screen.getByTestId("saved-backtest-period").textContent).toContain("hourly prices");
    // skipped bars are said once, by the run's own note, and never as "every bar had a price"
    expect(screen.getByTestId("saved-backtest-notes").textContent).toContain("10 of 100 bars had no price for an open leg and were not judged.");
    expect(screen.queryByTestId("saved-backtest-bars")).toBeNull();
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    expect(screen.getByTestId("saved-backtest-earlier").textContent).toContain("+$4.00 a day, 5 trades · settings since changed");
  });

  it("HC-TR-289 runs that cannot be read are said, and a run made stale by an edit is never shown as usable from an old answer", async () => {
    const s = saved({ name: "Edited" });
    ran(s, { figures: { mean: 4, per: "day", positivePct: 60, worst: -20, samples: 5, basis: "Backtest in the app" } });
    const u = await open("Edited");
    expect(screen.getByTestId("saved-backtest-use")).toBeTruthy();
    await u.click(screen.getByTestId("saved-backtest-close"));
    // the lots change in the editor; the dialog opened again right away reads the runs afresh
    await u.click(within(rowOf("Edited")).getByTestId("saved-edit"));
    fireEvent.change(screen.getByTestId("saved-lots"), { target: { value: "40" } });
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(s.definition.lots).toBe(40));
    await waitFor(() => expect(screen.queryByTestId("saved-save")).toBeNull());
    await u.click(within(rowOf("Edited")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-stale")).toBeTruthy());
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    await u.click(screen.getByTestId("saved-backtest-close"));
    // the strategy is gone on the server: the runs cannot be read, and that is said
    mock.state.savedStrategies.splice(mock.state.savedStrategies.indexOf(s), 1);
    await u.click(within(rowOf("Edited")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-load-error").textContent).toContain("Strategy not found"));
    expect(dialog().dataset["state"]).toBe("error");
  });
});

describe("HC-TR-290 the figures of a backtest in the app on the strategy", () => {
  it("HC-TR-290 Use these figures stores them with their source: the stage is Backtested, and the list and the editor say they were computed in the app", async () => {
    saved({ name: "Evening strangle" });
    saved({ name: "By hand", stage: "backtested", backtest: { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, real fees" }, backtestAt: "2026-11-25T10:00:00.000Z" });
    const u = await open();
    expect(within(rowOf("By hand")).getByTestId("saved-backtest-source").textContent).toBe("entered by hand · 25 Nov 2026");
    await u.click(within(rowOf("Evening strangle")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("none"));
    await u.click(screen.getByTestId("saved-backtest-run"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("done"));
    await u.click(screen.getByTestId("saved-backtest-use"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-used").textContent).toBe("These figures are on the strategy, marked as a backtest in the app. Its stage is Backtested: publish it from the list to trade on paper."));
    // used once: the button goes, and running again is the main step
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
    const stored = mock.state.savedStrategies.find((s) => s.name === "Evening strangle")!;
    expect(stored.stage).toBe("backtested");
    expect(stored.backtest).toMatchObject({ mean: 6.5, per: "day", positivePct: 66.7, worst: -40.25, samples: 3, run: { from: "2026-11-10", to: "2026-11-13", resolution: "5m" } });
    expect(stored.backtest!.run!.notes).toHaveLength(2);
    await u.click(screen.getByTestId("saved-backtest-close"));
    const row = rowOf("Evening strangle");
    await waitFor(() => expect(within(row).getByTestId("saved-stage").textContent).toBe("Backtested"));
    expect(within(row).getByTestId("saved-backtest").textContent).toContain("+$6.5 a day");
    expect(within(row).getByTestId("saved-backtest-source").textContent).toContain("backtest in the app · 5-minute prices");
    expect(within(row).getByTestId("saved-backtest").textContent).toContain("10 Nov 2026 to 13 Nov 2026");

    // the editor says where they came from; saving another field leaves them the app's
    await u.click(within(row).getByTestId("saved-edit"));
    expect(screen.getByTestId("saved-bt-source").textContent).toBe("These figures are a backtest in the app on 5-minute prices, 10 Nov 2026 to 13 Nov 2026. Changing anything here makes them figures entered by hand.");
    fireEvent.change(screen.getByTestId("saved-name"), { target: { value: "Evening strangle B" } });
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(mock.state.savedStrategies.find((s) => s.name === "Evening strangle B")).toBeTruthy());
    expect(stored.backtest!.run).toBeTruthy();
    // the figures were not touched, so they are not sent at all
    const patches = () => mock.calls.filter((c) => c.method === "PATCH").map((c) => JSON.parse(c.body!) as Record<string, unknown>);
    expect(patches().at(-1)).toEqual({ name: "Evening strangle B" });
    // a number changed by hand: the backtest's own sentence cannot stay as the source of the new figures
    await waitFor(() => expect(screen.queryByTestId("saved-save")).toBeNull());
    await u.click(within(rowOf("Evening strangle B")).getByTestId("saved-edit"));
    fireEvent.change(screen.getByTestId("saved-bt-mean"), { target: { value: "7" } });
    await u.click(screen.getByTestId("saved-save"));
    expect(screen.getByTestId("saved-error").textContent).toBe("These figures were a backtest in the app and you changed them: say where the new ones come from, in the field under them.");
    expect(stored.backtest!.mean).toBe(6.5);
    fireEvent.change(screen.getByTestId("saved-bt-basis"), { target: { value: "My own sheet, 10 to 13 Nov 2026" } });
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(stored.backtest!.mean).toBe(7));
    expect(stored.backtest!.run).toBeUndefined();
    expect(stored.backtest!.basis).toBe("My own sheet, 10 to 13 Nov 2026");
    await waitFor(() => expect(within(rowOf("Evening strangle B")).getByTestId("saved-backtest-source").textContent).toContain("entered by hand"));

    // the editor of figures typed by hand says so
    await waitFor(() => expect(screen.queryByTestId("saved-save")).toBeNull());
    await u.click(within(rowOf("By hand")).getByTestId("saved-edit"));
    expect(screen.getByTestId("saved-bt-source").textContent).toBe("These figures were entered by hand.");
  });

  it("HC-TR-290 new settings saved over figures of a backtest in the app do not carry those figures: the strategy is a draft again", async () => {
    const s = saved({ name: "Resettled" });
    const run = ran(s, { figures: { mean: 4, per: "day", positivePct: 60, worst: -20, samples: 5, basis: "Backtest in the app: 7 Aug to 20 Nov 2026" } });
    const u = await open("Resettled");
    await u.click(screen.getByTestId("saved-backtest-use"));
    await waitFor(() => expect(s.backtest?.run?.id).toBe(run.id));
    await u.click(screen.getByTestId("saved-backtest-close"));
    await waitFor(() => expect(within(rowOf("Resettled")).getByTestId("saved-stage").textContent).toBe("Backtested"));
    await u.click(within(rowOf("Resettled")).getByTestId("saved-edit"));
    fireEvent.change(screen.getByTestId("saved-lots"), { target: { value: "40" } });
    expect(screen.getByTestId("saved-cleared-note")).toBeTruthy();
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(s.definition.lots).toBe(40));
    const sent = JSON.parse(mock.calls.filter((c) => c.method === "PATCH").at(-1)!.body!) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["definition"]);
    expect(s.backtest).toBeNull();
    expect(s.stage).toBe("draft");
  });

  it("HC-TR-290 a strategy on paper stays on paper when it takes a run's figures, and a refusal to use them is said", async () => {
    const paper = saved({ name: "On paper", stage: "paper", backtest: { mean: 1, per: "day", positivePct: 50, worst: -9, samples: 10, basis: "typed" }, backtestAt: "2026-11-25T10:00:00.000Z" });
    const run = ran(paper, { figures: { mean: 3, per: "day", positivePct: 55, worst: -12, samples: 20, basis: "Backtest in the app" } });
    const other = saved({ name: "Raced" });
    ran(other, { figures: { mean: 3, per: "day", positivePct: 55, worst: -12, samples: 20, basis: "Backtest in the app" } });
    const u = await open("On paper");
    await u.click(screen.getByTestId("saved-backtest-use"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-used").textContent).toContain("It stays on paper."));
    expect(paper.stage).toBe("paper");
    expect(paper.backtest).toMatchObject({ mean: 3, run: { id: run.id } });
    await u.click(screen.getByTestId("saved-backtest-close"));

    // the settings change under an open dialog: the server refuses, in its words
    await u.click(within(rowOf("Raced")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-use")).toBeTruthy());
    other.definition = SavedDefinition.parse({ ...DAILY, lots: 10 });
    await u.click(screen.getByTestId("saved-backtest-use"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-refusal").textContent).toBe("The settings changed since this backtest ran: run it again"));
    expect(other.backtest).toBeNull();
    // a dialog reopened on figures already on the strategy says so and offers nothing to use again
    await u.click(screen.getByTestId("saved-backtest-close"));
    await u.click(within(rowOf("On paper")).getByTestId("saved-backtest-open"));
    await waitFor(() => expect(screen.getByTestId("saved-backtest-used")).toBeTruthy());
    expect(screen.queryByTestId("saved-backtest-use")).toBeNull();
  });
});

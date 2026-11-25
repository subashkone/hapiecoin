// The strategies a trader's Autopilot screen works with (HC-TR-279): the built-in list, and the saved ones the server
// sends for this trader beside it.
import { AUTOPILOT_PLAYBOOKS, playbookBacktest } from "@hapiecoin/pricing";
import { type SavedCard, SavedDefinition } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { BUILT_IN_CATALOGUE, catalogueOf } from "./autopilot-catalogue";

const DAILY = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: { legStop: 2 } });
const card = (over: Partial<SavedCard>): SavedCard => ({ id: "sv_a", version: 1, name: "Evening strangle 2 %", summary: "Sell both sides.", definition: DAILY, backtest: { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study" }, usable: true, ...over });
const BUILT_IN = AUTOPILOT_PLAYBOOKS[0]!;

describe("HC-TR-279 the Autopilot catalogue of one trader", () => {
  it("HC-TR-279 with no saved strategy it is the built-in list itself", () => {
    expect(catalogueOf(undefined)).toBe(BUILT_IN_CATALOGUE);
    expect(catalogueOf([])).toBe(BUILT_IN_CATALOGUE);
    expect(BUILT_IN_CATALOGUE.tradable).toBe(AUTOPILOT_PLAYBOOKS);
    expect(BUILT_IN_CATALOGUE.find(BUILT_IN.id)).toBe(BUILT_IN);
    expect(BUILT_IN_CATALOGUE.find(null)).toBeUndefined();
    expect(BUILT_IN_CATALOGUE.nameOf(BUILT_IN.id)).toBe(BUILT_IN.name);
    expect(BUILT_IN_CATALOGUE.nameOf("sv_gone")).toBe("sv_gone");
    expect(BUILT_IN_CATALOGUE.cadenceOf("sv_gone")).toBeNull();
    expect(BUILT_IN_CATALOGUE.isSaved(BUILT_IN.id)).toBe(false);
    expect(BUILT_IN_CATALOGUE.backtestOf("evening-strangle-stop-2x")).toEqual(playbookBacktest("evening-strangle-stop-2x"));
  });

  it("HC-TR-279 a saved strategy the trader may use is offered after the built-in ones, with the figures entered for it", () => {
    const weekly = card({ id: "sv_w", name: "Friday strangle", definition: SavedDefinition.parse({ ...DAILY, cadence: "weekly", weekdayUtc: 5, minDte: 6.5, maxDte: 7.5 }), backtest: null });
    const c = catalogueOf([card({}), weekly]);
    expect(c.tradable.map((p) => p.id)).toEqual([...AUTOPILOT_PLAYBOOKS.map((p) => p.id), "sv_a", "sv_w"]);
    expect(c.find("sv_a")).toMatchObject({ name: "Evening strangle 2 %", assets: ["BTC"], clock: { describe: "every day, 9:30 to 10:30 PM IST, on the next expiry", legStop: 2 } });
    expect(c.nameOf("sv_w")).toBe("Friday strangle");
    expect([c.cadenceOf("sv_a"), c.cadenceOf("sv_w"), c.cadenceOf(BUILT_IN.id)]).toEqual(["daily", "weekly", BUILT_IN_CATALOGUE.cadenceOf(BUILT_IN.id)]);
    expect(c.backtestOf("sv_a")).toMatchObject({ mean: 12.4, per: "day", samples: 106, basis: "autopilot-study" });
    expect(c.backtestOf("sv_w")).toBeUndefined();
    expect([c.isSaved("sv_a"), c.isSaved(BUILT_IN.id)]).toEqual([true, false]);
  });

  it("HC-TR-279 one the trader can no longer switch on is not offered, and keeps its name", () => {
    const c = catalogueOf([card({ id: "sv_old", name: "Retired strangle", usable: false })]);
    expect(c.tradable).toBe(AUTOPILOT_PLAYBOOKS);
    expect(c.nameOf("sv_old")).toBe("Retired strangle");
    expect(c.cadenceOf("sv_old")).toBe("daily");
    const both = catalogueOf([card({ id: "sv_old", usable: false }), card({ id: "sv_new", version: 2 })]);
    expect(both.tradable.map((p) => p.id).slice(-1)).toEqual(["sv_new"]);
  });
});

import { describe, expect, it } from "vitest";
import { TEMPLATE_CODES, legsCode, suggestStrategyName, templateCode } from "./naming";
import { TEMPLATES } from "./templates";

describe("HC-TR-155 pre-filled strategy names", () => {
  it("every template has a code, and unknown names fall back to the legs", () => {
    for (const t of TEMPLATES) expect(TEMPLATE_CODES[t.name], t.name).toBeTruthy();
    expect(templateCode("Iron Butterfly", [])).toBe("IBF");
    for (const n of ["Call Spread", "Put Spread", "Call Calendar", "Put Calendar", "Call Diagonal", "Put Diagonal", "Condor / Butterfly", "Futures", "Long Straddle", "Short Strangle"]) expect(TEMPLATE_CODES[n], n).toBeTruthy(); // every name guessTemplateName can return
    expect(templateCode("Something new", [{ kind: "call" }, { kind: "call" }, { kind: "put" }])).toBe("2C1P");
    expect(legsCode([{ kind: "future" }, { kind: "put" }])).toBe("1P1F");
    expect(legsCode([])).toBe("CUSTOM");
  });

  it("ASSET-CODE-DDMMMYY-HHMM from the trader's clock; a clash gets -2, -3", () => {
    const now = new Date(2026, 8, 11, 14, 32); // local time: 11 Sep 2026 14:32
    const legs = [{ kind: "call" }, { kind: "put" }];
    expect(suggestStrategyName({ asset: "BTC", templateName: "Iron Butterfly", legs, now })).toBe("BTC-IBF-11SEP26-1432");
    expect(suggestStrategyName({ asset: "ETH", templateName: "Custom", legs, now: new Date(2026, 0, 5, 9, 5) })).toBe("ETH-1C1P-05JAN26-0905");
    const taken = ["btc-ibf-11sep26-1432", "BTC-IBF-11SEP26-1432-2 "];
    expect(suggestStrategyName({ asset: "BTC", templateName: "Iron Butterfly", legs, now, taken })).toBe("BTC-IBF-11SEP26-1432-3");
  });
});

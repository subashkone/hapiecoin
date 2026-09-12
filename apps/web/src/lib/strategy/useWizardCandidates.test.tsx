// The wizard's pricing pass under React's development double-mount (ADR-072; HC-TR-177): the first CI run of the
// e2e found the panel stuck on "pricing" because the StrictMode unmount cleared the pass timer and the remount could
// not schedule another. The hook must reach `ready` under <StrictMode>, reset to `waiting` when the inputs go, and
// never lose a newer chain while a pass runs.
import { PricingClient, black76Price, createInlineTransport } from "@hapiecoin/pricing";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPricingClientForTests } from "@/lib/pricing/client";
import { TEMPLATES, type ChainStrike } from "./templates";
import { MIN_PASS_GAP_MS, type WizardPricingInput, useWizardCandidates } from "./useWizardCandidates";
import { eligibleTemplates } from "./wizard";

const SPOT = 80_000;
const IV = 0.3;
const STRIKES = Array.from({ length: 21 }, (_, i) => 70_000 + i * 1_000);
const ROWS: ChainStrike[] = STRIKES.map((k) => ({
  strike: String(k),
  call: { mark: black76Price(SPOT, k, 30 / 365, IV, true).toFixed(2), markIv: IV },
  put: { mark: black76Price(SPOT, k, 30 / 365, IV, false).toFixed(2), markIv: IV },
}));
const ELIGIBLE = eligibleTemplates(TEMPLATES);

function input(over: Partial<WizardPricingInput> = {}): WizardPricingInput {
  return { venue: "delta_india", asset: "BTC", expiry: "2026-10-10", expiries: ["2026-10-10"], rows: ROWS, atm: 10, lots: 10, spot: SPOT, lotSize: "0.001", nowMs: Date.UTC(2026, 8, 10, 12), version: 1, ...over };
}

function Probe({ inp }: { inp: WizardPricingInput }) {
  const p = useWizardCandidates(ELIGIBLE, inp);
  return <div data-testid="probe" data-state={p.state} data-running={String(p.running)} data-count={p.candidates.length} data-priced={p.pricedAt ?? ""} />;
}

beforeEach(() => {
  setPricingClientForTests(new PricingClient(createInlineTransport(), { timeoutMs: 8000 }));
});
afterEach(() => {
  setPricingClientForTests(null);
});

describe("HC-TR-177 useWizardCandidates", () => {
  it("reaches ready under StrictMode's double mount, with every eligible template priced", async () => {
    render(
      <StrictMode>
        <Probe inp={input()} />
      </StrictMode>,
    );
    const probe = screen.getByTestId("probe");
    expect(probe.dataset["state"]).toBe("pricing");
    await waitFor(() => expect(probe.dataset["state"]).toBe("ready"), { timeout: 15_000 });
    expect(Number(probe.dataset["count"])).toBe(ELIGIBLE.length);
    expect(probe.dataset["running"]).toBe("false");
  });

  it("waits without inputs, prices when they arrive, and keeps the last pass while a newer chain reprices", async () => {
    const { rerender } = render(<Probe inp={input({ spot: null })} />);
    const probe = screen.getByTestId("probe");
    expect(probe.dataset["state"]).toBe("waiting");
    rerender(<Probe inp={input()} />);
    await waitFor(() => expect(probe.dataset["state"]).toBe("ready"), { timeout: 15_000 });
    const first = probe.dataset["priced"];
    // a newer chain: the shown candidates stay (ready, the previous count) and one more pass lands after the gap
    // (the inline transport prices a pass within one task, so `running` is not observable here)
    rerender(<Probe inp={input({ version: 2 })} />);
    expect(probe.dataset["state"]).toBe("ready");
    expect(Number(probe.dataset["count"])).toBe(ELIGIBLE.length);
    await waitFor(() => expect(probe.dataset["priced"]).not.toBe(first), { timeout: MIN_PASS_GAP_MS + 10_000 });
    await waitFor(() => expect(probe.dataset["running"]).toBe("false"));
    expect(Number(probe.dataset["count"])).toBe(ELIGIBLE.length);
    // the inputs go away: back to waiting with nothing shown
    rerender(<Probe inp={input({ rows: [] })} />);
    await act(() => Promise.resolve());
    expect(probe.dataset["state"]).toBe("waiting");
    expect(probe.dataset["count"]).toBe("0");
  });
});

// The typed LIVE field on its own (HC-TR-186; GAPS #107): an empty field must look empty, the hint says what unlocks
// the button until the word is in, and the match shows as a green border plus a tick.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TypedConfirm } from "./TypedConfirm";

function Harness({ onSubmit, verb }: { onSubmit?: () => void; verb?: string }) {
  const [word, setWord] = useState("");
  return <TypedConfirm value={word} onChange={setWord} onSubmit={onSubmit} verb={verb} focusKey />;
}

describe("TypedConfirm", () => {
  it("HC-TR-186 never shows the word as the placeholder; the hint names the verb until the word is typed", async () => {
    const u = userEvent.setup();
    render(<Harness verb="retry" />);
    const field = screen.getByTestId<HTMLInputElement>("live-confirm");
    expect(field.placeholder).not.toContain("LIVE");
    expect(field.value).toBe("");
    expect(screen.getByTestId("live-confirm-field").dataset["ok"]).toBe("false");
    expect(screen.getByTestId("live-confirm-hint").textContent).toContain("the retry button below unlocks once LIVE is typed here");
    expect(screen.queryByTestId("live-confirm-ok")).toBeNull();
    expect(field.className).toContain("border-loss"); // red until the word is in
    await u.type(field, "liv");
    expect(field.value).toBe("LIV"); // uppercase-forced as typed
    expect(screen.getByTestId("live-confirm-hint")).toBeTruthy();
    await u.type(field, "e");
    expect(screen.getByTestId("live-confirm-field").dataset["ok"]).toBe("true");
    expect(screen.queryByTestId("live-confirm-hint")).toBeNull();
    expect(screen.getByTestId("live-confirm-ok")).toBeTruthy();
    expect(field.className).toContain("border-profit");
    expect(field.className).not.toContain("border-loss");
  });

  it("HC-TR-186 submits on Enter only with the word in, and the field is focused on open", async () => {
    const u = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const field = screen.getByTestId<HTMLInputElement>("live-confirm");
    expect(document.activeElement).toBe(field);
    await u.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await u.type(field, "LIVE{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

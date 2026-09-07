import { render, screen, act } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpInput, PasswordInput, PasswordRules, ResendCountdown } from "./inputs";

afterEach(() => vi.useRealTimers());

describe("HC-PB-027 PasswordInput", () => {
  it("toggles between password and text and swaps the label", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveProperty("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveProperty("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveProperty("type", "password");
  });
});

describe("HC-PB-032 PasswordRules", () => {
  it("turns rules green as they pass and colours the bar red → amber → green", () => {
    const { rerender } = render(<PasswordRules password="" />);
    expect(screen.getByTestId("strength-bar").dataset["tone"]).toBe("loss");
    expect(screen.getAllByRole("listitem").every((li) => li.dataset["ok"] === "false")).toBe(true);
    rerender(<PasswordRules password="Abc1" />);
    expect(screen.getByTestId("strength-bar").dataset["tone"]).toBe("warning");
    rerender(<PasswordRules password="Abc1!xyz" />);
    expect(screen.getByTestId("strength-bar").dataset["tone"]).toBe("profit");
    expect(screen.getByTestId("password-rules").dataset["valid"]).toBe("true");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "✓ Uppercase letter",
      "✓ Lowercase letter",
      "✓ Number",
      "✓ Special character",
      "✓ 8+ characters",
    ]);
  });
});

function Otp({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <OtpInput
      value={v}
      onChange={(c) => {
        setV(c);
        onChange(c);
      }}
    />
  );
}

describe("HC-PB-030 OtpInput", () => {
  it("auto-advances, accepts only digits, backspaces to the previous box and pastes a whole code", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Otp onChange={onChange} />);
    const boxes = screen.getAllByRole<HTMLInputElement>("textbox");
    expect(boxes).toHaveLength(6);
    expect(document.activeElement).toBe(boxes[0]);
    await user.keyboard("1");
    expect(document.activeElement).toBe(boxes[1]);
    await user.keyboard("a"); // ignored
    expect(boxes[1]!.value).toBe("");
    expect(document.activeElement).toBe(boxes[1]);
    await user.keyboard("2");
    expect(onChange).toHaveBeenLastCalledWith("12");
    await user.keyboard("{Backspace}"); // box 2 is empty now? no: it has "2" → clears it
    expect(boxes[1]!.value).toBe("");
    await user.keyboard("{Backspace}"); // moves back and clears box 1
    expect(document.activeElement).toBe(boxes[0]);
    expect(boxes[0]!.value).toBe("");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(boxes[1]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(boxes[0]);
    await user.paste("98-76 54");
    expect(onChange).toHaveBeenLastCalledWith("987654");
    expect(document.activeElement).toBe(boxes[5]);
    await user.paste("!!"); // no digits: ignored
    expect(onChange).toHaveBeenLastCalledWith("987654");
  });
  it("marks boxes invalid and skips autofocus when asked", () => {
    render(<OtpInput value="12" onChange={() => {}} invalid autoFocus={false} />);
    const boxes = screen.getAllByRole("textbox");
    expect(boxes[0]?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).not.toBe(boxes[0]);
  });
});

describe("HC-PB-030 ResendCountdown", () => {
  it("counts down from 30 s, then offers the link and restarts after a resend", async () => {
    vi.useFakeTimers();
    const onResend = vi.fn(() => Promise.resolve());
    render(<ResendCountdown prefix="Resend OTP in " linkText="Resend OTP" onResend={onResend} seconds={3} />);
    expect(screen.getByTestId("resend-countdown").textContent).toBe("Resend OTP in 3s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const btn = screen.getByTestId("resend-otp");
    expect(btn.textContent).toBe("Resend OTP");
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(onResend).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("resend-countdown").textContent).toBe("Resend OTP in 3s");
  });
});

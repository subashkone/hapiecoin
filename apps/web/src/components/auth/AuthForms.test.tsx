// Each /auth view against the in-memory mock API (Better Auth routes) via the fetch stub.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, type MockFetch } from "../../../test/helpers";
import { createAccount } from "../../../test/mock-api";
import { AuthForms, type AuthFormsProps } from "./AuthForms";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

function setup(overrides: Partial<AuthFormsProps> = {}) {
  const props: AuthFormsProps = {
    tab: "login",
    email: "",
    setEmail: vi.fn(),
    referral: "",
    googleEnabled: false,
    next: "",
    go: vi.fn(),
    finish: vi.fn(),
    ...overrides,
  };
  const utils = render(<AuthForms {...props} />);
  return { ...utils, props, user: userEvent.setup() };
}

describe("HC-PB-026 login", () => {
  it("validates inline, rejects bad credentials with the mock's toast copy, and finishes on success", async () => {
    createAccount(mock.state, { email: "asha@example.com", password: "Passw0rd!" });
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByText("Email is required")).toBeTruthy();
    expect(screen.getByText("Password is required")).toBeTruthy();
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByText("Invalid email")).toBeTruthy();
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(screen.getAllByText("Invalid credentials.").length).toBeGreaterThan(0));
    expect(props.finish).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Passw0rd!");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(props.finish).toHaveBeenCalled());
    expect(props.setEmail).toHaveBeenCalledWith("asha@example.com");
  });
  it("HC-PB-028 has the Delta button, hides Google unless enabled, and links to the other tabs", async () => {
    const { user, props, rerender } = setup();
    expect(screen.getByTestId("continue-delta").getAttribute("href")).toBe("/auth/delta");
    expect(screen.queryByTestId("continue-google")).toBeNull();
    await user.click(screen.getByTestId("go-forgot"));
    await user.click(screen.getByTestId("go-otp-login"));
    await user.click(screen.getByTestId("go-signup"));
    expect(vi.mocked(props.go).mock.calls.map((c) => c[0])).toEqual(["forgot", "otp-login", "signup"]);
    rerender(<AuthForms {...props} googleEnabled />);
    expect(screen.getByTestId("continue-google")).toBeTruthy();
  });
});

describe("HC-PB-029 / HC-PB-030 OTP sign-in", () => {
  it("sends the OTP then verifies it", async () => {
    const { user, props } = setup({ tab: "otp-login" });
    await user.click(screen.getByRole("button", { name: "Send OTP" }));
    expect(screen.getByText("Email is required")).toBeTruthy();
    await user.type(screen.getByLabelText("Email"), "otp@example.com");
    await user.click(screen.getByRole("button", { name: "Send OTP" }));
    await waitFor(() => expect(props.go).toHaveBeenCalledWith("otp-verify"));
    expect(props.setEmail).toHaveBeenCalledWith("otp@example.com");
    expect(mock.state.otps.get("otp@example.com:sign-in")).toBe("123456");
  });
  it("rejects an incomplete or wrong code and logs in with the right one", async () => {
    mock.state.otps.set("otp@example.com:sign-in", "123456");
    const { user, props } = setup({ tab: "otp-verify", email: "otp@example.com" });
    expect(screen.getByText("Code sent to otp@example.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Verify & Login" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter valid OTP");
    await user.click(screen.getAllByRole("textbox")[0]!);
    await user.paste("111111");
    await user.click(screen.getByRole("button", { name: "Verify & Login" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Enter valid OTP"));
    expect(props.finish).not.toHaveBeenCalled();
    const boxes = screen.getAllByRole("textbox");
    await user.click(boxes[0]!);
    await user.paste("123456");
    await user.click(screen.getByRole("button", { name: "Verify & Login" }));
    await waitFor(() => expect(props.finish).toHaveBeenCalled());
  });
  it("resend re-issues the code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup({ tab: "otp-verify", email: "otp@example.com" });
    await vi.advanceTimersByTimeAsync(30_000);
    await user.click(await screen.findByTestId("resend-otp"));
    await waitFor(() => expect(mock.state.otps.has("otp@example.com:sign-in")).toBe(true));
    vi.useRealTimers();
  });
});

describe("HC-PB-031 sign up and HC-PB-033 verify email", () => {
  it("validates every field with the mock's messages, then creates the account and moves to verify-email", async () => {
    const { user, props } = setup({ tab: "signup", referral: "REFABC1234" });
    expect(screen.getByPlaceholderText<HTMLInputElement>("REFK7P2Q9X").value).toBe("REFABC1234");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(screen.getByText("Full name is required")).toBeTruthy();
    expect(screen.getByText("Email is required")).toBeTruthy();
    expect(screen.getByText("Enter a valid mobile number")).toBeTruthy();
    expect(screen.getByText("Password does not meet all the requirements")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    await user.type(screen.getByLabelText("Full Name"), "Asha Trader");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Mobile Number"), "+91 98765 43210");
    await user.type(screen.getByLabelText("Password"), "Abc1!xyz");
    await user.type(screen.getByLabelText("Confirm"), "Abc1!xyz");
    await user.clear(screen.getByPlaceholderText("REFK7P2Q9X"));
    await user.type(screen.getByPlaceholderText("REFK7P2Q9X"), "bad");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(screen.getByText("Referral code looks invalid (10 characters, like REFK7P2Q9X)")).toBeTruthy();
    await user.clear(screen.getByPlaceholderText("REFK7P2Q9X"));
    // Typed lower-case: the form upper-cases it and the API matches it against the inviter's code.
    await user.type(screen.getByPlaceholderText("REFK7P2Q9X"), "refxyz7890");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(props.go).toHaveBeenCalledWith("verify-email"));
    const acc = mock.state.accounts.get("new@example.com");
    expect(acc?.user.mobile).toBe("9876543210");
    expect(acc?.emailVerified).toBe(false);
    expect(mock.state.otps.get("new@example.com:email-verification")).toBe("123456");
    const signupCall = mock.calls.find((c) => c.url.includes("/sign-up/email"));
    expect(signupCall?.body).toContain('"ref":"REFXYZ7890"');
    expect(mock.state.accounts.get("new@example.com")?.referredBy).toBe("REFXYZ7890");
    // the API sends the OTP with sign-up; the client must not request a second one
    expect(mock.calls.filter((c) => c.url.includes("send-verification-otp"))).toHaveLength(0);
  });
  it("reports an existing email", async () => {
    createAccount(mock.state, { email: "dup@example.com" });
    const { user } = setup({ tab: "signup" });
    await user.type(screen.getByLabelText("Full Name"), "Dup");
    await user.type(screen.getByLabelText("Email"), "dup@example.com");
    await user.type(screen.getByLabelText("Mobile Number"), "9876543210");
    await user.type(screen.getByLabelText("Password"), "Abc1!xyz");
    await user.type(screen.getByLabelText("Confirm"), "Abc1!xyz");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(screen.getAllByText("An account with this email already exists.").length).toBeGreaterThan(0));
  });
  it("verify-email: incomplete → toast; success signs in and finishes", async () => {
    createAccount(mock.state, { email: "new@example.com", verified: false });
    mock.state.otps.set("new@example.com:email-verification", "123456");
    const { user, props } = setup({ tab: "verify-email", email: "new@example.com" });
    expect(screen.getByText("We've sent a 6-digit OTP to new@example.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Verify Email" }));
    expect(screen.getByRole("alert").textContent).toBe("Please enter the complete 6-digit OTP");
    await user.click(screen.getAllByRole("textbox")[0]!);
    await user.paste("000000");
    await user.click(screen.getByRole("button", { name: "Verify Email" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Enter valid OTP"));
    await user.click(screen.getAllByRole("textbox")[0]!);
    await user.paste("123456");
    await user.click(screen.getByRole("button", { name: "Verify Email" }));
    await waitFor(() => expect(props.finish).toHaveBeenCalled());
    expect(mock.state.accounts.get("new@example.com")?.emailVerified).toBe(true);
  });
});

describe("HC-PB-034 / HC-PB-035 password reset", () => {
  it("forgot sends the OTP and moves on", async () => {
    createAccount(mock.state, { email: "asha@example.com" });
    const { user, props } = setup({ tab: "forgot", email: "asha@example.com" });
    await user.click(screen.getByRole("button", { name: "Send OTP" }));
    await waitFor(() => expect(props.go).toHaveBeenCalledWith("reset-password"));
    expect(mock.state.otps.get("asha@example.com:forget-password")).toBe("123456");
  });
  it("reset validates OTP length, rules and confirmation, then resets and returns to login", async () => {
    createAccount(mock.state, { email: "asha@example.com", password: "Old1!pass" });
    mock.state.otps.set("asha@example.com:forget-password", "123456");
    const { user, props } = setup({ tab: "reset-password", email: "asha@example.com" });
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(screen.getByText("Please enter the complete 6-digit OTP")).toBeTruthy();
    expect(screen.getByText("Password does not meet all the requirements")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    await user.type(screen.getByLabelText("OTP"), "12a3456"); // non-digits stripped, capped at 6
    expect(screen.getByLabelText<HTMLInputElement>("OTP").value).toBe("123456");
    await user.type(screen.getByLabelText("New Password"), "New1!pass");
    await user.type(screen.getByLabelText("Confirm Password"), "New1!pass");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    await waitFor(() => expect(props.go).toHaveBeenCalledWith("login"));
    expect(mock.state.accounts.get("asha@example.com")?.password).toBe("New1!pass");
  });
  it("reset with a wrong code shows the error", async () => {
    createAccount(mock.state, { email: "asha@example.com" });
    const { user, props } = setup({ tab: "reset-password", email: "asha@example.com" });
    await user.type(screen.getByLabelText("OTP"), "999999");
    await user.type(screen.getByLabelText("New Password"), "New1!pass");
    await user.type(screen.getByLabelText("Confirm Password"), "New1!pass");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    await waitFor(() => expect(screen.getAllByText("Enter valid OTP").length).toBeGreaterThan(0));
    expect(props.go).not.toHaveBeenCalled();
  });
});

describe("HC-PB-068 the second factor after a password sign-in (ADR-078)", () => {
  it("a 2FA account goes to the code step instead of finishing; the code step signs in with the app code or a backup code", async () => {
    const acc = createAccount(mock.state, { email: "totp@example.com", password: "Passw0rd!", verified: true });
    acc.twoFactor = { enabled: true, pending: false, backupCodes: ["AAAA-1111", "BBBB-2222"] };
    const { user, props } = setup({ tab: "login" });
    await user.type(screen.getByLabelText("Email"), "totp@example.com");
    await user.type(screen.getByLabelText("Password"), "Passw0rd!");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(props.go).toHaveBeenCalledWith("totp"));
    expect(props.finish).not.toHaveBeenCalled();
    expect(props.setEmail).toHaveBeenCalledWith("totp@example.com");
    // the code step: a wrong code is refused with a plain sentence, the right one finishes
    const step = setup({ tab: "totp", email: "totp@example.com" });
    expect(step.getByTestId("auth-totp")).toBeTruthy();
    await step.user.click(step.getByTestId("totp-verify"));
    expect(step.getByTestId("totp-error").textContent).toContain("6-digit code");
    const boxes = within(step.getByTestId("otp-input")).getAllByRole("textbox");
    await step.user.click(boxes[0]!);
    await step.user.keyboard("111111");
    await step.user.click(step.getByTestId("totp-verify"));
    await waitFor(() => expect(step.getByTestId("totp-error").textContent).toContain("not right"));
    expect(step.props.finish).not.toHaveBeenCalled();
    await step.user.click(boxes[0]!);
    await step.user.keyboard("{Control>}a{/Control}{Backspace}");
    await step.user.click(step.getByTestId("totp-toggle-backup"));
    await step.user.type(step.getByTestId("totp-backup"), "AAAA-1111");
    await step.user.click(step.getByTestId("totp-verify"));
    await waitFor(() => expect(step.props.finish).toHaveBeenCalled());
    expect(acc.twoFactor.backupCodes).toEqual(["BBBB-2222"]); // each backup code works once
  });
});

describe("HC-PB-068 a refused social sign-in comes back with its reason (ADR-078)", () => {
  it("shows the server's sentence from the error params and clears them from the URL", async () => {
    window.history.replaceState(null, "", "/auth?tab=login&next=%2Fanalyse&error=TWO_FACTOR_REQUIRED&error_description=This+account+uses+an+authenticator+app%3A+sign+in+with+your+password+and+the+code");
    setup({ tab: "login", googleEnabled: true });
    expect((await screen.findByTestId("login-notice")).textContent).toContain("authenticator app");
    expect(window.location.search).toBe("?tab=login&next=%2Fanalyse");
    window.history.replaceState(null, "", "/");
  });
});

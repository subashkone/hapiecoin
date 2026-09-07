import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { routerMock } from "../../../test/next-mocks";
import { AuthScreen, PARENT_TAB, authHref } from "./AuthScreen";
import { DeltaSignIn } from "./DeltaSignIn";
import { SsoReturn } from "./SsoReturn";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
});
afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

describe("HC-PB-024 tab state in the URL", () => {
  it("authHref preserves next= and ref=", () => {
    expect(authHref("signup", "", "")).toBe("/auth?tab=signup");
    expect(authHref("login", "/analyse", "REF_X")).toBe("/auth?tab=login&next=%2Fanalyse&ref=REF_X");
    expect(PARENT_TAB["otp-verify"]).toBe("otp-login");
  });
  it("HC-PB-023 renders the brand column, feature rows and live ticker; cold sub-step falls back to its parent", async () => {
    renderWithProviders(<AuthScreen tab="otp-verify" next="" referral="" googleEnabled={false} />);
    expect(screen.getByText("Master Options")).toBeTruthy();
    expect(screen.getByText("Real-time Analytics")).toBeTruthy();
    expect(screen.getByText("© 2025 HapieCoin · Secure & encrypted")).toBeTruthy();
    // no email known on a cold visit → parent step (otp-login)
    await waitFor(() => expect(screen.getByTestId("auth-otp-login")).toBeTruthy());
    // HC-PB-061 live futures ticker updates from spot frames
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79521.5", c24: -1.86 });
    });
    await waitFor(() => expect(screen.getByTestId("ticker-BTC").textContent).toContain("79,521.5"));
    expect(screen.getByTestId("ticker-BTC").textContent).toContain("-1.86%");
  });
  it("keeps the email across steps via sessionStorage and navigates with go()/finish()", async () => {
    window.sessionStorage.setItem("hapiecoin.auth.email", "kept@example.com");
    renderWithProviders(<AuthScreen tab="otp-verify" next="/subscription" referral="REF_1" googleEnabled={false} />);
    await waitFor(() => expect(screen.getByText("Code sent to kept@example.com")).toBeTruthy());
    screen.getByText("← Change email").click();
    expect(routerMock.push).toHaveBeenCalledWith("/auth?tab=otp-login&next=%2Fsubscription&ref=REF_1");
  });
});

describe("HC-PB-037 Delta sign-in page", () => {
  it("shows the spinner, then explains that Delta login arrives with live trading", () => {
    vi.useFakeTimers();
    renderWithProviders(<DeltaSignIn delayMs={500} />);
    expect(screen.getByText("Signing you in with Delta…")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("delta-signin").dataset["phase"]).toBe("info");
    expect(screen.getByText("Arrives with live trading")).toBeTruthy();
    expect(screen.getByText("Back to sign in").closest("a")?.getAttribute("href")).toBe("/auth");
  });
});

describe("HC-PB-038 SSO return", () => {
  it("redirects to the target after the delay", () => {
    vi.useFakeTimers();
    renderWithProviders(<SsoReturn target="/analyse" delayMs={300} />);
    expect(screen.getByText("Signing you in…")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(routerMock.replace).toHaveBeenCalledWith("/analyse");
  });
});

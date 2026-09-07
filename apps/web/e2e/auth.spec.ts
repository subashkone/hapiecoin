import { TEST_OTP, expect, fillOtp, seedUser, signIn, test } from "./fixtures";

test.describe("HC-PB-031 / HC-PB-033 sign up → OTP → verify → /analyse", () => {
  test("HC-PB-031 creates the account, verifies the email OTP and lands on /analyse", async ({ page }) => {
    await page.goto("/auth?tab=signup&ref=REFABC1234");
    await expect(page.getByTestId("auth-signup")).toBeVisible();
    await expect(page.getByPlaceholder("REFK7P2Q9X")).toHaveValue("REFABC1234");
    await page.getByLabel("Full Name").fill("Asha Trader");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("asha@example.com");
    await page.getByLabel("Mobile Number").fill("9876543210");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Abc1!xyz9");
    await expect(page.getByTestId("password-rules")).toHaveAttribute("data-valid", "true");
    await page.getByRole("textbox", { name: "Confirm", exact: true }).fill("Abc1!xyz9");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/tab=verify-email/);
    await expect(page.getByText("We've sent a 6-digit OTP to asha@example.com")).toBeVisible();
    await expect(page.getByTestId("resend-countdown")).toContainText("Resend in");
    await fillOtp(page, TEST_OTP);
    await page.getByRole("button", { name: "Verify Email" }).click();
    await page.waitForURL(/\/analyse/);
    await expect(page.getByTestId("app-header")).toHaveAttribute("data-variant", "analyse");
  });
});

test.describe("HC-PB-065 Continue with Google", () => {
  test("HC-PB-065 the provider callback lands on the web origin and /analyse opens signed in", async ({ page }) => {
    await page.goto("/auth");
    await page.getByTestId("continue-google").click();
    // The mock provider redirects through /v1/auth/callback/google on the web origin (ADR-019), so the
    // session cookie is first-party and the protected route does not bounce back to /auth.
    await page.waitForURL(/\/analyse/);
    await expect(page.getByTestId("app-header")).toHaveAttribute("data-variant", "analyse");
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === "better-auth.session_token" && c.domain === "localhost")).toBe(true);
  });
});

test.describe("HC-PB-029 / HC-PB-030 OTP login", () => {
  test("HC-PB-030 sends the code, rejects an incomplete code, then logs in", async ({ page, request }) => {
    await seedUser(request, { email: "otp@example.com" });
    await page.goto("/auth");
    await page.getByTestId("go-otp-login").click();
    await expect(page).toHaveURL(/tab=otp-login/);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("otp@example.com");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/tab=otp-verify/);
    await page.getByRole("button", { name: "Verify & Login" }).click();
    await expect(page.getByTestId("auth-otp-verify").getByRole("alert")).toHaveText("Enter valid OTP");
    await fillOtp(page, TEST_OTP);
    await page.getByRole("button", { name: "Verify & Login" }).click();
    await page.waitForURL(/\/analyse/);
  });
});

test.describe("HC-PB-034 / HC-PB-035 reset password", () => {
  test("HC-PB-035 resets the password and signs in with the new one", async ({ page, request }) => {
    await seedUser(request, { email: "reset@example.com", password: "Old1!pass" });
    await page.goto("/auth");
    await page.getByTestId("go-forgot").click();
    await page.getByLabel("Email Address").fill("reset@example.com");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/tab=reset-password/);
    await page.getByLabel("OTP", { exact: true }).fill(TEST_OTP);
    await page.getByRole("textbox", { name: "New Password", exact: true }).fill("New1!pass");
    await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill("New1!pass");
    await page.getByRole("button", { name: "Reset Password" }).click();
    await expect(page).toHaveURL(/tab=login/);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("reset@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("New1!pass");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(/\/analyse/);
  });
});

test.describe("HC-PB-025 / HC-PB-036 redirects", () => {
  test("HC-PB-036 protected route sends guests to /auth?next= and returns them after login", async ({ page, request }) => {
    await seedUser(request, { email: "next@example.com" });
    await page.goto("/analyse");
    await expect(page).toHaveURL(/\/auth\?next=%2Fanalyse/);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("next@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Passw0rd!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(/\/analyse/);
  });
  test("HC-PB-025 logged-in visitors are redirected away from /auth", async ({ page, request }) => {
    await seedUser(request, { email: "in@example.com" });
    await signIn(page, "in@example.com");
    await page.goto("/auth?next=%2Fsubscription");
    await expect(page).toHaveURL(/\/subscription/);
    await expect(page.getByTestId("phase-placeholder")).toBeVisible();
  });
  test("HC-PB-037 / HC-PB-038 Delta hand-off explains itself; SSO returns to the app", async ({ page }) => {
    await page.goto("/auth");
    await page.getByTestId("continue-delta").click();
    await expect(page).toHaveURL(/\/auth\/delta/);
    await expect(page.getByText("Signing you in with Delta…")).toBeVisible();
    await expect(page.getByText("Arrives with live trading")).toBeVisible({ timeout: 5000 });
    await page.goto("/sso?sso_return=%2Fprivacy");
    await expect(page.getByText("Signing you in…")).toBeVisible();
    await expect(page).toHaveURL(/\/privacy/, { timeout: 5000 });
  });
});

test.describe("HC-PB-026 login validation and HC-PB-027 password eye", () => {
  test("HC-PB-026 shows inline errors and a failure toast, and the eye toggles the field", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("nobody@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong");
    await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Login failed")).toBeVisible();
  });
});

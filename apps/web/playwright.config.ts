// Playwright e2e: starts the mock API + fake gateway (test/servers.ts) and `next dev` pointed at them.
// Screenshots for the visual comparison land in e2e/__screenshots__/ (dark + light).
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 3100);
const API_PORT = Number(process.env["MOCK_API_PORT"] ?? 3101);
const GATEWAY_PORT = Number(process.env["MOCK_GATEWAY_PORT"] ?? 3102);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // localhost, not 127.0.0.1: `next dev` serves chunks and the HMR socket to its own origin (allowedDevOrigins covers the rest).
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env["PW_CHANNEL"] ?? "chrome" },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx test/servers.ts",
      url: `http://127.0.0.1:${API_PORT}/__test/otp`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: { MOCK_API_PORT: String(API_PORT), MOCK_GATEWAY_PORT: String(GATEWAY_PORT) },
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/privacy`,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      env: {
        API_URL: `http://127.0.0.1:${API_PORT}`,
        NEXT_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:${GATEWAY_PORT}`,
        // The mock API implements the social sign-in round trip (HC-PB-065), so the button is shown.
        NEXT_PUBLIC_GOOGLE_ENABLED: "true",
      },
    },
  ],
});

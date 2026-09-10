// Smoke run against the REAL API and gateway (ADR-055, GAPS #20): `pnpm test:smoke`. Needs network access to Delta
// Exchange India's public feed (the gateway's /healthz stays 503 without it). Separate ports from the mock e2e.
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env["SMOKE_WEB_PORT"] ?? 3200);
const API_PORT = Number(process.env["SMOKE_API_PORT"] ?? 3201);
const GATEWAY_PORT = Number(process.env["SMOKE_GATEWAY_PORT"] ?? 3202);
const SIDECAR_PORT = Number(process.env["SMOKE_SIDECAR_PORT"] ?? 3203);

export default defineConfig({
  testDir: "./e2e-smoke",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results-smoke",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env["PW_CHANNEL"] ?? "chrome" } }],
  webServer: [
    {
      command: "pnpm exec tsx test/real-servers.ts",
      url: `http://127.0.0.1:${SIDECAR_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { SMOKE_API_PORT: String(API_PORT), SMOKE_GATEWAY_PORT: String(GATEWAY_PORT), SMOKE_SIDECAR_PORT: String(SIDECAR_PORT), SMOKE_WEB_PORT: String(WEB_PORT) },
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/privacy`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_URL: `http://127.0.0.1:${API_PORT}`, NEXT_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:${GATEWAY_PORT}`, NEXT_PUBLIC_GOOGLE_ENABLED: "false" },
    },
  ],
});

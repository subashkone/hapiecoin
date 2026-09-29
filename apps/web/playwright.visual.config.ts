// The visual suite (visual.spec.ts and guide.spec.ts): `pnpm test:visual` (ADR-096, HC-SH-139, GAPS #119 / #20).
// Its own mock stack on its own ports so the calendar can be pinned: the mock API's clock starts at VISUAL_NOW, the
// fake gateway serves the recording as recorded and never ticks, and every page's clock is pinned to VISUAL_NOW as
// well and the Next dev overlay is hidden (e2e/shot.ts), so a picture shows the same expiries, days-to-expiry, prices
// and dates on any real day at any hour. With E2E_PIXELS=1 each picture is compared against e2e/__baselines__ (the
// CI runner's Chromium on Linux; refreshed by the "baseline" job in .github/workflows/ci.yml) within the tolerance
// below. Pictures are 1280 x 720 (the Desktop Chrome profile), as the captures have always been.
import { defineConfig, devices } from "@playwright/test";
import { VISUAL_NOW } from "./test/expiry-shift";

const WEB_PORT = Number(process.env["VISUAL_WEB_PORT"] ?? 3110);
const API_PORT = Number(process.env["VISUAL_API_PORT"] ?? 3111);
const GATEWAY_PORT = Number(process.env["VISUAL_GATEWAY_PORT"] ?? 3112);
// the specs' fixtures reach the mock API by MOCK_API_PORT (e2e/fixtures.ts); the workers inherit this environment
process.env["MOCK_API_PORT"] = String(API_PORT);
process.env["MOCK_GATEWAY_PORT"] = String(GATEWAY_PORT);

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/visual\.spec\.ts/, /guide\.spec\.ts/],
  // the same function before and after: next-env.d.ts is put back even when the previous run was killed
  globalSetup: "./e2e/visual-teardown.ts",
  globalTeardown: "./e2e/visual-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0, // a picture that only matches on a second attempt is not the same picture
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // the visual gate: at most 150 pixels may differ (a wrong digit or a missing icon is more), and never more than
    // 0.2 % of a picture; animations frozen, no caret
    toHaveScreenshot: { maxDiffPixels: 150, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" },
  },
  snapshotPathTemplate: "e2e/__baselines__/{arg}-{projectName}-{platform}{ext}",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-visual" }]],
  outputDir: "test-results-visual",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env["PW_CHANNEL"] ?? "chrome" } }],
  webServer: [
    {
      command: "pnpm exec tsx test/servers.ts",
      url: `http://127.0.0.1:${API_PORT}/__test/otp`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        MOCK_API_PORT: String(API_PORT),
        MOCK_GATEWAY_PORT: String(GATEWAY_PORT),
        MOCK_CLOCK_AT: VISUAL_NOW,
        MOCK_CALENDAR: "recorded",
        MOCK_TICK_MS: "0",
      },
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/privacy`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_URL: `http://127.0.0.1:${API_PORT}`,
        NEXT_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:${GATEWAY_PORT}`,
        NEXT_PUBLIC_GOOGLE_ENABLED: "true",
        NEXT_DIST_DIR: ".next-visual", // its own build folder and lock: `pnpm dev` can stay up during a visual run
      },
    },
  ],
});

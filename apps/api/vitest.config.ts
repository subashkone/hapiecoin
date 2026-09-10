import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// API package: base({ strict: false }) raised to the Phase 1 brief's gates (95 % lines/functions, 90 % branches).
// Excluded from coverage: the process entrypoints (main.ts, *-cli.ts) and the test harness (test-support/).
export default mergeConfig(
  base({ strict: false }),
  defineConfig({
    test: {
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: { NODE_ENV: "test" },
      // Each test file boots its own PGlite (WASM Postgres); running many in parallel exhausts memory
      // on CI-sized machines and crashes workers. Two forks keep the suite under ~1 GB.
      pool: "forks",
      maxWorkers: 2,
      coverage: {
        exclude: [
          "src/**/*.test.*",
          "src/**/*.d.ts",
          "src/**/index.ts",
          "src/**/fixtures/**",
          "src/test-support/**",
          "src/main.ts",
          "src/db/migrate-cli.ts",
          "src/db/seed-cli.ts",
          "src/db/reseal-cli.ts",
        ],
        thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  }),
);

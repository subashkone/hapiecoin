import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// The ingest service feeds every analytics chart: strict gates like the gateway (100 % lines/functions/statements, >= 95 % branches).
export default mergeConfig(
  base({ strict: true }),
  defineConfig({
    test: {
      coverage: {
        exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/test-support/**"],
      },
    },
  }),
);

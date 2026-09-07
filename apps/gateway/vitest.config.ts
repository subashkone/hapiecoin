import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// The gateway fans out market data that traders act on: strict gates (100 % lines/functions/statements, >= 95 % branches).
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

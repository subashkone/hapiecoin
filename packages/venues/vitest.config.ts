import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

export default mergeConfig(
  base({ strict: true }),
  defineConfig({
    test: {
      coverage: {
        exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/**/fixtures/**", "src/test-support/**"],
      },
    },
  }),
);

import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// Money-math package: strict coverage gates (100 % lines/functions/statements, >= 95 % branches).
export default mergeConfig(
  base({ strict: true }),
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
    },
  }),
);

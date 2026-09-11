import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// JSX is transformed by Vite's oxc pipeline using tsconfig.json (`jsx: react-jsx`).
export default mergeConfig(
  base({ environment: "jsdom" }),
  defineConfig({
    test: {
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      // the Preview page renders every component in both themes; under coverage on a 2-core CI runner that
      // takes longer than the 5 s default (same allowance as apps/web and apps/api)
      testTimeout: 60_000,
      hookTimeout: 60_000,
      // the Preview file alone renders every component twice; one fork per core alongside the dev stack ran the
      // machine out of memory ("Zone Allocation failed", GAPS #78), so half the cores, as in apps/web
      maxWorkers: "50%",
      coverage: {
        exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/test/**", "src/icons.ts"],
      },
    },
  }),
);

import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// JSX is transformed by Vite's oxc pipeline using tsconfig.json (`jsx: react-jsx`).
export default mergeConfig(
  base({ environment: "jsdom" }),
  defineConfig({
    test: {
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      coverage: {
        exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/test/**", "src/icons.ts"],
      },
    },
  }),
);

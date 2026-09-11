import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import base from "@hapiecoin/config/vitest";

// JSX: the Next tsconfig keeps `jsx: preserve`, so tell oxc to emit the automatic runtime for tests.
const config: ViteUserConfig = mergeConfig(
  base({ environment: "jsdom" }),
  defineConfig({
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
      setupFiles: ["./test/setup.ts"],
      css: false,
      // jsdom + user-event flows price real legs and open Radix dialogs; under the full turbo gate (every
      // package's coverage and build at once) the default 5 s per test timed out on a loaded laptop.
      testTimeout: 20_000,
      // 88 test files each fork a jsdom worker; at one fork per core on a 16 GB machine that also runs the dev
      // stack the forks died of memory pressure (exit 134 / 0xC0000409) after their tests had passed (GAPS #78).
      maxWorkers: "50%",
    },
  }),
);

// Coverage scope is the brief's "src/lib and src/components ≥ 90 %". Assigned after the merge because
// mergeConfig concatenates arrays and would otherwise keep the base `src/**` include (route files, proxy).
// auth/server.ts is `server-only` (Next headers()) and is exercised by the Playwright redirect tests.
config.test = {
  ...config.test,
  coverage: {
    ...config.test?.coverage,
    include: ["src/lib/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/**/fixtures/**", "src/lib/auth/server.ts"],
  },
};

export default config;

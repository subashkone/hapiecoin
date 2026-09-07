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

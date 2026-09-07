// Shared Vitest configuration. Coverage gates are strict on purpose: the product owner asked for
// everything to be tested; packages that carry money math (pricing, schema, venues) require 100 % lines.
// Consumers: `import { defineConfig, mergeConfig } from "vitest/config"; import base from "@hapiecoin/config/vitest";
//            export default mergeConfig(base({ strict: true }), defineConfig({ ... }));`
export default function base(opts = {}) {
  const strict = opts.strict === true;
  const thresholds = strict
    ? { lines: 100, functions: 100, branches: 95, statements: 100 }
    : { lines: 90, functions: 90, branches: 85, statements: 90 };
  return {
    test: {
      environment: opts.environment ?? "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts", "test/**/*.test.tsx"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
      passWithNoTests: false,
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary", "lcov"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.*", "src/**/*.d.ts", "src/**/index.ts", "src/**/fixtures/**"],
        thresholds,
      },
    },
  };
}

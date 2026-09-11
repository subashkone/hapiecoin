// @hapiecoin/web lint: shared base (type-checked TS, token guard, identity guard) plus Next.js output ignores.
import base from "@hapiecoin/config/eslint";

export default [
  { ignores: ["**/*.css", ".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...base,
  {
    // ADR-064: only the browser-safe core of the venue port; the package root reaches node:crypto
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@hapiecoin/venues", message: "Import @hapiecoin/venues/core in the web app; the package root pulls in node:crypto (ADR-064)." }] }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,mjs,ts}"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];

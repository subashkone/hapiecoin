// @hapiecoin/web lint: shared base (type-checked TS, token guard, identity guard) plus Next.js output ignores.
import base from "@hapiecoin/config/eslint";

export default [
  { ignores: ["**/*.css", ".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...base,
  {
    files: ["scripts/**/*.mjs", "*.config.{js,mjs,ts}"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];

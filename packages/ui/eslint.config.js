// @hapiecoin/ui lint: shared base (type-checked TS, token guard, identity guard) plus package-local tweaks.
import base from "@hapiecoin/config/eslint";

export default [
  // ESLint has no CSS parser here; the shared token guard's ".css" glob would parse CSS as TypeScript.
  // Hex literals in CSS are guarded by src/tokens.test.ts ("only tokens.css may contain #rrggbb literals").
  { ignores: ["**/*.css"] },
  ...base,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  },
];

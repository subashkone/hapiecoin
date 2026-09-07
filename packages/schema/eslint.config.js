// ESLint flat config for @hapiecoin/schema: the shared HapieCoin config plus an override that
// lints this package's own config files without type information (they sit outside tsconfig "include").
import base from "@hapiecoin/config/eslint";
import tseslint from "typescript-eslint";

export default [
  ...base,
  {
    files: ["eslint.config.js", "vitest.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
];

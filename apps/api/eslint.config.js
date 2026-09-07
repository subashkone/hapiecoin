import base from "@hapiecoin/config/eslint";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "coverage/**", "drizzle/**", ".pglite/**"] },
  ...base,
  {
    files: ["eslint.config.js", "vitest.config.ts", "drizzle.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
];

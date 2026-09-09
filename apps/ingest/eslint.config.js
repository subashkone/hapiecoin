import base from "@hapiecoin/config/eslint";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "coverage/**"] },
  ...base,
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

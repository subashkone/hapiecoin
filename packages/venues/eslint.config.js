import base from "@hapiecoin/config/eslint";

export default [
  { ignores: ["dist/**", "coverage/**"] },
  ...base,
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

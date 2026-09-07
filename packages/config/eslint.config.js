// Shared ESLint flat config for every HapieCoin package.
// Consumers: `import base from "@hapiecoin/config/eslint"; export default [...base];`
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/** Design-token guard: hard-coded colours and non-token font families are build errors in UI code (ADR-003). */
const tokenGuard = {
  files: ["**/*.{ts,tsx}"],
  ignores: ["**/tokens.css", "**/*.test.*", "**/fixtures/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
        message: "Hard-coded colour. Use a design token (hsl(var(--...))) from @hapiecoin/ui.",
      },
      {
        selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]",
        message: "Hard-coded colour. Use a design token (hsl(var(--...))) from @hapiecoin/ui.",
      },
    ],
  },
};

/** Product identity guard: the competitor's name must not appear in product code (ADR-001). */
const identityGuard = {
  files: ["**/*.{ts,tsx,js,jsx}"],
  ignores: ["**/*.test.*", "**/fixtures/**", "**/venues/**", "**/eslint.config.js"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/CoinGreeks|coingreeks/]",
        message: "Product name is HapieCoin (ADR-001). 'CoinGreeks' is only allowed when referring to the original site in docs or tests.",
      },
    ],
  },
};

export default [
  { ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: process.cwd() },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  // Plain JS files (configs, scripts) are linted without type information.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  tokenGuard,
  identityGuard,
  prettier,
];

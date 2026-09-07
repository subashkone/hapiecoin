import base from "./packages/config/eslint.config.js";

export default [
  { ignores: ["mockup-clone/**", "mockup-v2/**", "graphify-out/**", "spec/**", "docs/**", ".claude/**"] },
  ...base,
];

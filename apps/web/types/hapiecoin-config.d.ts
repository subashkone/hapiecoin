// Type surface of the shared JS configs in @hapiecoin/config (they ship no .d.ts).
declare module "@hapiecoin/config/vitest" {
  import type { ViteUserConfig } from "vitest/config";
  export default function base(opts?: { strict?: boolean; environment?: string }): ViteUserConfig;
}
declare module "@hapiecoin/config/eslint" {
  import type { Linter } from "eslint";
  const config: Linter.Config[];
  export default config;
}
